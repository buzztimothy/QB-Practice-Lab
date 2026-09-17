import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';
import { deactivatePreviewStudent } from '../scripts/preview-deactivation.js';
import { PreviewProvisioningService } from '../apps/web/preview-provisioning.js';
import { StudentApplication } from '../apps/student/application.js';
import { bootstrapCanonicalLab, PrismaStudentAttemptRepository } from '../apps/student/persistence.js';

const url=process.env.DATABASE_URL;
if(url)assertDisposableTestDatabase(url,process.env.DATABASE_LIFECYCLE_MARKER);
const prisma=new PrismaClient(), describeDb=url?describe:describe.skip;
describeDb('emergency deactivation persistence boundary',()=>{
  const suffix=crypto.randomUUID(), a=`deactivation-a-${suffix}`, b=`deactivation-b-${suffix}`;
  beforeAll(async()=>{await prisma.$connect();await bootstrapCanonicalLab(prisma);});
  afterAll(async()=>{await prisma.$disconnect();}); // Retain immutable history in the disposable database; never bypass triggers for cleanup.
  it('deactivates only A through the existing service and preserves all ledger/source/history rows',async()=>{
    const app=new StudentApplication(new PrismaStudentAttemptRepository(prisma));
    for(const id of [a,b]){
      await prisma.runtimeStudent.create({data:{id,displayName:'Disposable controlled student',email:`${id}@example.test`}});
      await prisma.externalIdentityLink.create({data:{studentId:id,provider:'clerk',subject:id,email:`${id}@example.test`}});
      await prisma.previewInvitation.create({data:{studentId:id,email:`${id}@example.test`,status:'SENT'}});
      await prisma.studentSession.create({data:{studentId:id,subject:id,displayName:'Disposable controlled student',tokenHash:createHash('sha256').update(id).digest('hex'),expiresAt:new Date(Date.now()+60_000)}});
      const model=await app.start({studentId:id});
      await app.act({studentId:id},model.shell.attemptId,{type:'CLOSE_BOOKS'});
    }
    const tables=['case_templates','template_accounts','template_customers','template_documents','canonical_lab_bootstrap','runtime_attempts','student_attempts','attempt_accounts','attempt_customers','journal_entries','journal_lines','attempt_actions','invoices','invoice_lines','customer_payments','payment_applications','bank_deposits','bank_deposit_payments','reconciliations','reconciliation_lines','runtime_historical_reconciliation_lines','runtime_audit_events','runtime_idempotency','runtime_snapshots','provider_webhook_events'];
    const protectedDigest=async()=>{
      const rows=[];
      for(const table of tables){
        const values=await prisma.$queryRawUnsafe<{value:string}[]>(`SELECT row_to_json(t)::text AS value FROM "${table}" t`);
        rows.push([table,values.map(x=>x.value).sort()]);
      }
      return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    };
    const control=()=>prisma.runtimeStudent.findUnique({where:{id:b},include:{identities:true,invitations:true,sessions:true}});
    const before=await protectedDigest(), controlBefore=await control();
    const clerk=createClerkClient({secretKey:'sk_test_disposable_unused'});
    const invite=vi.spyOn(clerk.invitations,'createInvitation');
    const service=new PreviewProvisioningService(prisma,clerk,'https://preview.clientpracticelabs.com/auth/callback');
    const invoked=vi.spyOn(service,'deactivate');
    const result=await deactivatePreviewStudent(prisma,service,a);
    expect(invoked).toHaveBeenCalledExactlyOnceWith(a);
    expect(invite).not.toHaveBeenCalled();
    expect(result).toMatchObject({studentId:a,success:true,before:{status:'ACTIVE',activeIdentityLinks:1,unrevokedSessions:1,runtimeAttempts:1,ledgerAttempts:1},after:{status:'DEACTIVATED',activeIdentityLinks:0,unrevokedSessions:0,runtimeAttempts:1,ledgerAttempts:1}});
    expect(result.before.snapshots).toBeGreaterThan(0);
    expect(await prisma.previewInvitation.findFirst({where:{studentId:a},select:{status:true}})).toEqual({status:'REVOKED'});
    expect(await protectedDigest()).toBe(before);
    expect(await control()).toEqual(controlBefore);
    expect((await deactivatePreviewStudent(prisma,service,a)).success).toBe(true);
    expect(await protectedDigest()).toBe(before);
    await expect(deactivatePreviewStudent(prisma,service,`missing-${suffix}`)).rejects.toThrow('Target unavailable');
  },60_000);
});
