import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eligibility, integrity, recoveryScope, runRecoveryMode, validateInventory } from '../scripts/recovery-workflow.js';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';
import { bootstrapCanonicalLab } from '../apps/student/persistence.js';
import { InvitationRecoveryService } from '../apps/web/invitation-recovery.js';
import type { RecoveryProviderInvitation } from '../apps/web/invitation-recovery-provider.js';

const url=process.env.DATABASE_URL;
if(url)assertDisposableTestDatabase(url,process.env.DATABASE_LIFECYCLE_MARKER);
const db=url?describe:describe.skip;
const prisma=new PrismaClient();
db('recovery workflow read-only and preservation gates',()=>{
  beforeAll(async()=>{
    await bootstrapCanonicalLab(prisma);
    await prisma.runtimeStudent.create({data:{id:recoveryScope.studentId,email:recoveryScope.email,displayName:'Disposable controlled fixture',status:'INVITED'}});
    await prisma.previewInvitation.create({data:{studentId:recoveryScope.studentId,email:recoveryScope.email,status:'SENT',providerInvitationId:recoveryScope.oldInvitationId}});
  });
  afterAll(async()=>{await prisma.$disconnect();});
  it('reads eligibility and integrity without writing journal or lifecycle data',async()=>{
    const before=await integrity(prisma),journal=await prisma.invitationRecovery.count();
    const id=await eligibility(prisma);
    expect(id).toBeTruthy();
    await runRecoveryMode('preflight',{preflight:async()=>{await eligibility(prisma);},invokeCli:async()=>{throw new Error('Mutation in preflight');},postcheck:async()=>{throw new Error('Unexpected postcheck');}});
    expect(await integrity(prisma)).toBe(before);expect(await prisma.invitationRecovery.count()).toBe(journal);
    await expect(eligibility(prisma,'inv_wrong')).rejects.toThrow();
  });
  it('detects control-student and canonical drift',async()=>{
    const before=await integrity(prisma);
    await prisma.runtimeStudent.create({data:{id:recoveryScope.controlId,displayName:'Disposable control',status:'INVITED'}});
    await expect(eligibility(prisma)).rejects.toThrow();expect(await integrity(prisma)).not.toBe(before);
    await prisma.runtimeStudent.delete({where:{id:recoveryScope.controlId}});
    expect(await integrity(prisma)).toBe(before);
  });
  it('permits only the provider reference change while retaining invitation identity and all other rows',async()=>{
    const before=await integrity(prisma),id=await eligibility(prisma);
    const rows:RecoveryProviderInvitation[]=[{id:recoveryScope.oldInvitationId,email:recoveryScope.email,status:'pending'}];
    const provider={inspect:async()=>({users:0,invitations:rows.map(r=>({...r}))}),revoke:async()=>{rows[0].status='revoked';},create:async(email:string,_redirect:string,operationId:string)=>{rows.push({id:'inv_workflowReplacement',email,status:'pending',recoveryId:operationId});return 'inv_workflowReplacement';}};
    validateInventory(await provider.inspect());
    const result=await new InvitationRecoveryService(prisma,provider,'https://accounts.example/sign-up').recover(recoveryScope);
    expect(result.success).toBe(true);
    expect(await eligibility(prisma,'inv_workflowReplacement')).toBe(id);
    expect(await integrity(prisma)).toBe(before);
    const journal=await prisma.invitationRecovery.findUniqueOrThrow({where:{provider_oldProviderInvitationId:{provider:'clerk',oldProviderInvitationId:recoveryScope.oldInvitationId}}});
    expect(journal).toMatchObject({status:'COMPLETED',invitationId:id});
    validateInventory(await provider.inspect(),{id:'inv_workflowReplacement',operationId:journal.id});
    await prisma.previewInvitation.update({where:{id},data:{status:'PENDING'}});
    expect(await integrity(prisma)).not.toBe(before);
    await expect(eligibility(prisma,'inv_workflowReplacement')).rejects.toThrow();
  });
});
