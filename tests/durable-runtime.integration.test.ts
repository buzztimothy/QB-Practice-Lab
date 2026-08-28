import { PrismaClient } from '@prisma/client';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError } from '../packages/accounting-domain/src/errors.js';
import { StudentApplication } from '../apps/student/application.js';
import { bootstrapCanonicalLab, PrismaStudentAttemptRepository } from '../apps/student/persistence.js';
import { PrismaStudentSessionAuthenticator } from '../apps/web/authentication.js';

const url=process.env.DATABASE_URL;
const describeDb=url?describe:describe.skip;
const prisma=new PrismaClient();
const extraClients:PrismaClient[]=[];
const extra=()=>{const client=new PrismaClient();extraClients.push(client);return client;};
const request=(cookie?:string)=>({headers:{cookie}} as IncomingMessage);
const cookieValue=(header:string)=>header.split(';',1)[0];

describeDb('D-000 durable runtime',()=>{
  beforeAll(async()=>{await bootstrapCanonicalLab(prisma);});
  afterAll(async()=>{await Promise.all(extraClients.map(client=>client.$disconnect()));await prisma.$disconnect();});

  it('survives application replacement with bookkeeping, evidence, conversation, coaching, and audit state intact',async()=>{
    const studentId=`d000-restart-${Date.now()}`,auth={studentId};
    const first=new StudentApplication(new PrismaStudentAttemptRepository(prisma));let view=await first.start(auth);const attemptId=view.shell.attemptId;
    const target=view.data.bankEntries[0];expect((await first.act(auth,attemptId,{type:'BOOKKEEPING',command:{type:'REVIEW',targetId:target.id},context:{expectedRevision:0,idempotencyKey:'restart-review',help:'INDEPENDENT'}})).ok).toBe(true);
    view=await first.view(auth,{attemptId,screen:'documents'});const document=view.data.documents.find(item=>item.title.includes('Client Information'))!;expect((await first.act(auth,attemptId,{type:'OPEN_DOCUMENT',documentId:document.id})).ok).toBe(true);
    view=await first.view(auth,{attemptId,screen:'inbox'});const conversationId=view.data.inbox[0].id;expect((await first.act(auth,attemptId,{type:'COACH_DRAFT',conversationId,draft:'How should I request the payroll report?',level:'HINT'})).ok).toBe(true);expect((await first.act(auth,attemptId,{type:'SEND_MESSAGE',conversationId,content:'Please send the payroll support report.'})).ok).toBe(true);
    const restarted=new StudentApplication(new PrismaStudentAttemptRepository(extra()));const restored=await restarted.view(auth,{attemptId,screen:'coach'});
    expect(restored.shell.revision).toBe(1);expect(restored.data.coaching).toHaveLength(1);expect(restored.data.inbox[0].messages.map(item=>item.sender)).toEqual(['STUDENT','CLIENT']);expect(restored.data.documents.find(item=>item.id===document.id)?.state).toBe('AVAILABLE_AT_START');
  },30_000);

  it('enforces cross-instance CAS and durable idempotency without duplicating a command',async()=>{
    const studentId=`d000-cas-${Date.now()}`,auth={studentId},one=new StudentApplication(new PrismaStudentAttemptRepository(prisma)),two=new StudentApplication(new PrismaStudentAttemptRepository(extra()));
    const initial=await one.start(auth),attemptId=initial.shell.attemptId,target=initial.data.bankEntries[0].id;
    const action={type:'BOOKKEEPING' as const,command:{type:'REVIEW' as const,targetId:target},context:{expectedRevision:0,idempotencyKey:'cross-instance-once',help:'INDEPENDENT' as const}};
    expect((await one.act(auth,attemptId,action)).ok).toBe(true);expect((await two.act(auth,attemptId,action)).ok).toBe(true);expect((await two.view(auth,{attemptId})).shell.revision).toBe(1);
    const staleTarget=initial.data.bankEntries[1].id,stale=await two.act(auth,attemptId,{type:'BOOKKEEPING',command:{type:'REVIEW',targetId:staleTarget},context:{expectedRevision:0,idempotencyKey:'cross-instance-stale',help:'INDEPENDENT'}});expect(stale).toMatchObject({ok:false,stale:true});
    const receipts=await prisma.runtimeIdempotency.count({where:{attemptId,idempotencyKey:'cross-instance-once'}});expect(receipts).toBe(1);
  },30_000);

  it('keeps persisted ownership fail-closed and reset history restart-safe',async()=>{
    const studentId=`d000-owner-${Date.now()}`,auth={studentId},app=new StudentApplication(new PrismaStudentAttemptRepository(prisma));const started=await app.start(auth);
    await expect(app.view({studentId:`${studentId}-foreign`},{attemptId:started.shell.attemptId})).rejects.toBeInstanceOf(NotFoundError);
    const reset=await app.act(auth,started.shell.attemptId,{type:'RESET_ATTEMPT'});expect(reset.ok).toBe(true);const restarted=new StudentApplication(new PrismaStudentAttemptRepository(extra()));const history=await restarted.view(auth,{attemptId:reset.attemptId,screen:'history'});expect(history.history).toHaveLength(2);expect(history.history[0].status).toBe('RESET');expect(history.shell.attemptNumber).toBe(2);
  });

  it('persists hashed sessions and makes revocation authoritative across instances',async()=>{
    const rawToken=Buffer.from(`d000-session-${Date.now()}`).toString('base64url').padEnd(43,'x'),first=new PrismaStudentSessionAuthenticator(prisma,{token:()=>rawToken}),second=new PrismaStudentSessionAuthenticator(extra());
    const created=await first.create('STUDENT_A');expect(created).not.toBeNull();const cookie=cookieValue(created!.cookie);expect(await second.authenticate(request(cookie))).toMatchObject({studentId:'student-a'});expect((await prisma.studentSession.findFirst({where:{studentId:'student-a'},orderBy:{createdAt:'desc'}}))?.tokenHash).not.toBe(rawToken);
    await first.destroy(request(cookie));expect(await second.authenticate(request(cookie))).toBeNull();
  });

  it('keeps canonical bootstrap idempotent and immutable snapshots protected',async()=>{
    const before=await prisma.runtimeAttempt.count();const first=await bootstrapCanonicalLab(prisma),second=await bootstrapCanonicalLab(prisma);expect(second).toEqual(first);expect(await prisma.runtimeAttempt.count()).toBe(before);
    const studentId=`d000-snapshot-${Date.now()}`,app=new StudentApplication(new PrismaStudentAttemptRepository(prisma)),started=await app.start({studentId});await app.act({studentId},started.shell.attemptId,{type:'CLOSE_BOOKS'});const snapshot=await prisma.runtimeSnapshot.findFirst({where:{attemptId:started.shell.attemptId,kind:'ASSESSMENT'}});expect(snapshot).not.toBeNull();await expect(prisma.runtimeSnapshot.update({where:{id:snapshot!.id},data:{contentHash:'tampered'}})).rejects.toThrow(/immutable/);
  });
});
