import type { IncomingMessage } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCanonicalLab } from '../apps/student/persistence.js';
import { PrismaStudentSessionAuthenticator } from '../apps/web/authentication.js';
import { PreviewIdentityService } from '../apps/web/production-authentication.js';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';

const url=process.env.DATABASE_URL;
if(url)assertDisposableTestDatabase(url,process.env.DATABASE_LIFECYCLE_MARKER);
const describeDb=url?describe:describe.skip,prisma=new PrismaClient();
const request=(cookie?:string)=>({headers:{cookie}} as IncomingMessage);

describeDb('D-002 relational identity and lifecycle enforcement',()=>{
  const suffix=crypto.randomUUID(),studentId=`d002-student-${suffix}`,email=`d002-${suffix}@example.test`;
  beforeAll(async()=>{await prisma.$connect();await bootstrapCanonicalLab(prisma);});
  afterAll(async()=>{await prisma.studentSession.deleteMany({where:{studentId}});await prisma.externalIdentityLink.deleteMany({where:{studentId}});await prisma.previewInvitation.deleteMany({where:{studentId}});await prisma.runtimeStudent.deleteMany({where:{id:studentId}});await prisma.providerWebhookEvent.deleteMany({where:{providerEventId:{contains:suffix}}});await prisma.$disconnect();});

  it('atomically consumes an invitation, preserves subject ownership, replaces sessions, and fails closed for an impostor',async()=>{
    await prisma.runtimeStudent.create({data:{id:studentId,displayName:'D-002 Student',email,status:'INVITED'}});
    await prisma.previewInvitation.create({data:{studentId,email,provider:'clerk',providerInvitationId:`inv_${suffix}`,status:'SENT'}});
    const service=new PreviewIdentityService(prisma,28_800,()=>new Date('2026-08-28T12:00:00.000Z'));
    const first=await service.exchange(request(),{provider:'clerk',subject:`user_${suffix}`,email});
    expect(first?.cookie).toMatch(/^bbb_student_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=28800$/);
    expect(await prisma.previewInvitation.findFirst({where:{studentId}})).toMatchObject({status:'CONSUMED',consumedSubject:`user_${suffix}`});
    expect(await prisma.externalIdentityLink.findFirst({where:{studentId}})).toMatchObject({subject:`user_${suffix}`,email,active:true});
    expect((await prisma.runtimeStudent.findUniqueOrThrow({where:{id:studentId}})).status).toBe('ACTIVE');

    const auth=new PrismaStudentSessionAuthenticator(prisma,{now:()=>Date.parse('2026-08-28T12:01:00.000Z')});
    const firstCookie=first!.cookie.split(';')[0];
    expect((await auth.authenticate(request(firstCookie)))?.studentId).toBe(studentId);
    const second=await service.exchange(request(firstCookie),{provider:'clerk',subject:`user_${suffix}`,email});
    expect(second).not.toBeNull();
    expect(await auth.authenticate(request(firstCookie))).toBeNull();
    expect((await auth.authenticate(request(second!.cookie.split(';')[0])))?.studentId).toBe(studentId);
    await expect(prisma.externalIdentityLink.update({where:{provider_subject:{provider:'clerk',subject:`user_${suffix}`}},data:{subject:`user_changed_${suffix}`}})).rejects.toThrow();
    expect(await service.exchange(request(),{provider:'clerk',subject:`impostor_${suffix}`,email})).toBeNull();
    await service.processWebhook({id:`evt_pre_${suffix}`,type:'user.deleted',subject:`blocked_${suffix}`,disabled:true});
    expect(await service.exchange(request(),{provider:'clerk',subject:`blocked_${suffix}`,email})).toBeNull();
  });

  it('handles lifecycle replay idempotently, revokes access, and preserves accounting history',async()=>{
    const template=await prisma.caseTemplate.findUniqueOrThrow({where:{slug:'suncoast-lab-1'}});
    const attempt=await prisma.studentAttempt.create({data:{studentId,templateId:template.id,generation:91}});
    const service=new PreviewIdentityService(prisma,28_800,()=>new Date('2026-08-28T13:00:00.000Z'));
    await service.processWebhook({id:`evt_email_${suffix}`,type:'user.updated',subject:`user_${suffix}`,email:`changed-${email}`,disabled:false});
    expect(await prisma.externalIdentityLink.findFirst({where:{studentId}})).toMatchObject({subject:`user_${suffix}`,email:`changed-${email}`});
    expect((await prisma.studentAttempt.findUniqueOrThrow({where:{id:attempt.id}})).studentId).toBe(studentId);
    const event={id:`evt_${suffix}`,type:'user.deleted' as const,subject:`user_${suffix}`,disabled:true};
    await service.processWebhook(event);await service.processWebhook(event);
    expect(await prisma.providerWebhookEvent.count({where:{provider:'clerk',providerEventId:event.id}})).toBe(1);
    expect(await prisma.externalIdentityLink.findFirst({where:{studentId}})).toMatchObject({active:false});
    expect((await prisma.runtimeStudent.findUniqueOrThrow({where:{id:studentId}})).status).toBe('DEACTIVATED');
    expect(await prisma.studentSession.count({where:{studentId,revokedAt:null}})).toBe(0);
    expect(await prisma.studentAttempt.findUnique({where:{id:attempt.id}})).not.toBeNull();
    await prisma.studentAttempt.delete({where:{id:attempt.id}});
  });

  it('serializes initial exchange against a concurrent disabling webhook',async()=>{
    const raceSuffix=crypto.randomUUID(),raceStudent=`d002-race-${raceSuffix}`,raceEmail=`d002-race-${raceSuffix}@example.test`,subject=`user_race_${raceSuffix}`,eventId=`evt_race_${raceSuffix}`;
    await prisma.runtimeStudent.create({data:{id:raceStudent,displayName:'D-002 Race Student',email:raceEmail,status:'INVITED'}});
    await prisma.previewInvitation.create({data:{studentId:raceStudent,email:raceEmail,provider:'clerk',providerInvitationId:`inv_race_${raceSuffix}`,status:'SENT'}});
    const service=new PreviewIdentityService(prisma,28_800,()=>new Date('2026-08-28T14:00:00.000Z'));
    try{
      const [exchange]=await Promise.all([
        service.exchange(request(),{provider:'clerk',subject,email:raceEmail}),
        service.processWebhook({id:eventId,type:'user.deleted',subject,disabled:true}),
      ]);
      expect((await prisma.runtimeStudent.findUniqueOrThrow({where:{id:raceStudent}})).status).toBe('DEACTIVATED');
      expect(await prisma.studentSession.count({where:{studentId:raceStudent,revokedAt:null}})).toBe(0);
      if(exchange){const auth=new PrismaStudentSessionAuthenticator(prisma);expect(await auth.authenticate(request(exchange.cookie.split(';')[0]))).toBeNull();}
    }finally{
      await prisma.studentSession.deleteMany({where:{studentId:raceStudent}});await prisma.externalIdentityLink.deleteMany({where:{studentId:raceStudent}});await prisma.previewInvitation.deleteMany({where:{studentId:raceStudent}});await prisma.runtimeStudent.delete({where:{id:raceStudent}});await prisma.providerWebhookEvent.deleteMany({where:{providerEventId:eventId}});
    }
  });
});
