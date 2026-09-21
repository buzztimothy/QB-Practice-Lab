import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InvitationRecoveryService } from '../apps/web/invitation-recovery.js';
import type { InvitationRecoveryProvider, RecoveryProviderInvitation } from '../apps/web/invitation-recovery-provider.js';
import { PreviewIdentityService } from '../apps/web/production-authentication.js';
import { PreviewProvisioningService } from '../apps/web/preview-provisioning.js';
import { bootstrapCanonicalLab } from '../apps/student/persistence.js';
import { clerkAccountPortalUrl, previewApplicationOrigin } from '../apps/web/clerk-account-portal.js';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';
import { applyPreviewRuntimeGrants } from '../scripts/preview-runtime-grants.js';

const url=process.env.DATABASE_URL;
if(url)assertDisposableTestDatabase(url,process.env.DATABASE_LIFECYCLE_MARKER);
const db=url?describe:describe.skip, p=new PrismaClient();
const redirect=clerkAccountPortalUrl('https://accounts.example/sign-in',previewApplicationOrigin,'sign-up');
const request={headers:{}} as IncomingMessage;

db('durable invitation recovery',()=>{
  beforeAll(async()=>{await p.$connect();await bootstrapCanonicalLab(p);});
  afterAll(async()=>{await p.$disconnect();}); // Immutable journal evidence stays in disposable DB.
  async function fixture(){
    const suffix=crypto.randomUUID().replaceAll('-',''),id=`recovery-${suffix}`,email=`${id}@example.test`,old=`inv_${suffix}`;
    await p.runtimeStudent.create({data:{id,email,displayName:'Disposable',status:'INVITED'}});
    const invitation=await p.previewInvitation.create({data:{studentId:id,email,status:'SENT',providerInvitationId:old}});
    const rows:RecoveryProviderInvitation[]=[{id:old,email,status:'pending'}];
    const inspect=vi.fn(async()=>({users:0,invitations:rows.map(v=>({...v}))}));
    const revoke=vi.fn(async(providerId:string)=>{expect(await p.invitationRecovery.count({where:{invitationId:invitation.id,phase:'OLD_REVOCATION_PENDING'}})).toBe(1);rows.find(v=>v.id===providerId)!.status='revoked';});
    const create=vi.fn(async(address:string,target:string,operation:string)=>{expect(await p.invitationRecovery.count({where:{id:operation,phase:'REPLACEMENT_CREATE_PENDING'}})).toBe(1);expect(address).toBe(email);expect(target).toBe(redirect);const replacement=`inv_new${suffix}`;rows.push({id:replacement,email,status:'pending',recoveryId:operation});return replacement;});
    const provider:InvitationRecoveryProvider={inspect,revoke,create};
    const target={studentId:id,oldInvitationId:old};
    const service=()=>new InvitationRecoveryService(p,provider,redirect);
    const journal=()=>p.invitationRecovery.findUniqueOrThrow({where:{provider_oldProviderInvitationId:{provider:'clerk',oldProviderInvitationId:old}}});
    return {id,email,old,invitation,rows,inspect,revoke,create,provider,target,service,journal};
  }
  async function noLifecycle(id:string){
    expect((await p.runtimeStudent.findUniqueOrThrow({where:{id}})).status).toBe('INVITED');
    expect(await p.externalIdentityLink.count({where:{studentId:id}})).toBe(0);
    expect(await p.studentSession.count({where:{studentId:id}})).toBe(0);
    expect(await p.runtimeAttempt.count({where:{studentId:id}})).toBe(0);
    expect(await p.studentAttempt.count({where:{studentId:id}})).toBe(0);
  }
  async function sourceDigest(){
    const rows=[];
    for(const table of ['case_templates','template_accounts','template_customers','template_documents','canonical_lab_bootstrap'])rows.push(await p.$queryRawUnsafe(`SELECT row_to_json(t)::text AS value FROM "${table}" t ORDER BY row_to_json(t)::text`));
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }

  it('completes once, preserves identity/history/control/source, and allows normal exchange afterward',async()=>{
    const f=await fixture(),control=await fixture(),before=await p.runtimeStudent.findUnique({where:{id:control.id}}),digest=await sourceDigest();
    const result=await f.service().recover(f.target);
    expect(result).toMatchObject({success:true,status:'COMPLETED',phase:'COMPLETED'});
    expect(f.revoke).toHaveBeenCalledOnce();expect(f.create).toHaveBeenCalledOnce();
    const j=await f.journal();
    expect(j.oldProviderInvitationId).toBe(f.old);expect(j.replacementProviderInvitationId).toBe(f.rows[1].id);expect(j.completedAt).not.toBeNull();
    expect(await p.previewInvitation.findUnique({where:{id:f.invitation.id}})).toMatchObject({providerInvitationId:f.rows[1].id,status:'SENT',studentId:f.id,email:f.email});
    await noLifecycle(f.id);await noLifecycle(control.id);
    expect(await p.runtimeStudent.findUnique({where:{id:control.id}})).toEqual(before);expect(await sourceDigest()).toBe(digest);
    await expect(p.invitationRecovery.delete({where:{id:j.id}})).rejects.toThrow();
    await expect(p.invitationRecovery.update({where:{id:j.id},data:{failure:'PROVIDER_UNAVAILABLE'}})).rejects.toThrow();
    expect(await f.service().recover(f.target)).toEqual(result);expect(f.create).toHaveBeenCalledOnce();
    const auth=new PreviewIdentityService(p,300);
    expect(await auth.exchange(request,{provider:'clerk',subject:`user_${f.id}`,email:f.email})).not.toBeNull();
    expect(await f.service().recover(f.target)).toEqual(result); // Historical retry never starts new recovery.
  });

  it('blocks exchange throughout interrupted recovery, and concurrent invocations make one create',async()=>{
    const f=await fixture();let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const original=f.revoke.getMockImplementation()!;
    let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
    f.revoke.mockImplementation(async id=>{entered();await wait;await original(id);});
    const running=f.service().recover(f.target);await ready;
    const auth=new PreviewIdentityService(p,300);
    expect(await auth.exchange(request,{provider:'clerk',subject:`user_${f.id}`,email:f.email})).toBeNull();await noLifecycle(f.id);
    const second=await f.service().recover(f.target);expect(second.success).toBe(false);
    release();expect((await running).success).toBe(true);
    expect(f.revoke).toHaveBeenCalledOnce();expect(f.create).toHaveBeenCalledOnce();
  });

  it.each(['explicit','timeout'] as const)('never blindly retries a %s revoke failure',async kind=>{
    const f=await fixture();f.revoke.mockRejectedValueOnce(new Error(`private-token-${kind}`));
    const failed=await f.service().recover(f.target);expect(failed).toMatchObject({status:'BLOCKED',failure:'REVOCATION_UNCONFIRMED'});expect(JSON.stringify(failed)).not.toContain('private');
    expect((await f.service().recover(f.target)).success).toBe(false);expect(f.revoke).toHaveBeenCalledOnce();expect(f.create).not.toHaveBeenCalled();await noLifecycle(f.id);
    f.rows[0].status='revoked';expect((await f.service().recover(f.target)).success).toBe(true);expect(f.revoke).toHaveBeenCalledOnce();
  });

  it('reconciles a revocation that succeeded before the response was lost',async()=>{
    const f=await fixture();f.revoke.mockImplementationOnce(async()=>{f.rows[0].status='revoked';throw new Error('private timeout');});
    expect((await f.service().recover(f.target)).success).toBe(false);
    expect((await f.service().recover(f.target)).success).toBe(true);expect(f.revoke).toHaveBeenCalledOnce();expect(f.create).toHaveBeenCalledOnce();
  });

  it.each(['explicit','timeout'] as const)('blocks after %s create failure with no provable candidate',async kind=>{
    const f=await fixture();f.create.mockRejectedValueOnce(new Error(`private-${kind}`));
    expect(await f.service().recover(f.target)).toMatchObject({failure:'CREATION_UNCONFIRMED',status:'BLOCKED'});
    expect(f.rows[0].status).toBe('revoked');expect((await f.journal()).phase).toBe('REPLACEMENT_CREATE_PENDING');
    expect((await f.service().recover(f.target)).success).toBe(false);expect(f.create).toHaveBeenCalledOnce();await noLifecycle(f.id);
    expect(await new PreviewIdentityService(p,300).exchange(request,{provider:'clerk',subject:`user_${f.id}`,email:f.email})).toBeNull();
  });

  it('adopts a correlated replacement after a creation response timeout',async()=>{
    const f=await fixture(),create=f.create.getMockImplementation()!;
    f.create.mockImplementationOnce(async(...args)=>{await create(...args);throw new Error('private-url');});
    expect((await f.service().recover(f.target)).success).toBe(false);
    expect((await f.service().recover(f.target)).success).toBe(true);expect(f.create).toHaveBeenCalledOnce();
  });

  it.each(['REPLACEMENT_IDENTIFIED','COMPLETED'] as const)('recovers after local persistence fails at %s',async phase=>{
    const f=await fixture();
    // The trigger simulates a database failure without changing service behavior.
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION recovery_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.student_id = '${f.id}' AND NEW.phase = '${phase}' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END; $$`);
    await p.$executeRawUnsafe('CREATE TRIGGER recovery_test_failure_trigger BEFORE UPDATE ON invitation_recoveries FOR EACH ROW EXECUTE FUNCTION recovery_test_failure()');
    try{expect(await f.service().recover(f.target)).toMatchObject({success:false,failure:'LOCAL_PERSISTENCE_FAILED'});expect((await p.previewInvitation.findUniqueOrThrow({where:{id:f.invitation.id}})).providerInvitationId).toBe(f.old);}finally{await p.$executeRawUnsafe('DROP TRIGGER recovery_test_failure_trigger ON invitation_recoveries');await p.$executeRawUnsafe('DROP FUNCTION recovery_test_failure()');}
    expect((await f.service().recover(f.target)).success).toBe(true);expect(f.create).toHaveBeenCalledOnce();await noLifecycle(f.id);
  });

  it('blocks multiple correlated replacements and unavailable/incomplete provider evidence',async()=>{
    const f=await fixture(),create=f.create.getMockImplementation()!;
    f.create.mockImplementationOnce(async(...args)=>{const id=await create(...args);f.rows.push({...f.rows[1],id:`inv_other${f.old.slice(4)}`});return id;});
    expect(await f.service().recover(f.target)).toMatchObject({status:'BLOCKED',failure:'PROVIDER_STATE_AMBIGUOUS'});
    expect((await f.service().recover(f.target)).success).toBe(false);expect(f.create).toHaveBeenCalledOnce();
    const g=await fixture();g.inspect.mockRejectedValue(new Error('private-secret'));
    expect(await g.service().recover(g.target)).toMatchObject({failure:'PROVIDER_UNAVAILABLE'});expect(g.revoke).not.toHaveBeenCalled();
  });

  it.each(['ACTIVE','DEACTIVATED','PENDING','CONSUMED','REVOKED','mapping','session','attempt','wrong-id','wrong-email','wrong-provider','missing'] as const)('rejects local guard: %s',async kind=>{
    const f=await fixture();
    if(kind==='ACTIVE'||kind==='DEACTIVATED')await p.runtimeStudent.update({where:{id:f.id},data:{status:kind}});
    if(kind==='PENDING'||kind==='CONSUMED'||kind==='REVOKED')await p.previewInvitation.update({where:{id:f.invitation.id},data:{status:kind}});
    if(kind==='mapping')await p.externalIdentityLink.create({data:{studentId:f.id,provider:'clerk',subject:f.id,email:f.email}});
    if(kind==='session')await p.studentSession.create({data:{studentId:f.id,subject:f.id,displayName:'Test',tokenHash:f.id,expiresAt:new Date(Date.now()+60000)}});
    if(kind==='attempt'){const t=await p.caseTemplate.findFirstOrThrow();await p.studentAttempt.create({data:{studentId:f.id,templateId:t.id,generation:1}});}
    if(kind==='wrong-email')await p.runtimeStudent.update({where:{id:f.id},data:{email:`other-${f.email}`}});
    if(kind==='wrong-provider')await p.previewInvitation.update({where:{id:f.invitation.id},data:{provider:'other'}});
    const target={...f.target,...(kind==='wrong-id'?{oldInvitationId:'inv_wrong'}:{}),...(kind==='missing'?{studentId:'missing-student'}:{})};
    expect(await f.service().recover(target)).toMatchObject({success:false,failure:'PRECONDITION_FAILED'});expect(f.revoke).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
  });

  it.each(['user','email','accepted','extra-pending'] as const)('rejects provider guard: %s',async kind=>{
    const f=await fixture();
    if(kind==='user')f.inspect.mockResolvedValue({users:1,invitations:f.rows});
    if(kind==='email')f.rows[0].email='wrong@example.test';
    if(kind==='accepted')f.rows[0].status='accepted';
    if(kind==='extra-pending')f.rows.push({id:'inv_extra',email:f.email,status:'pending'});
    expect(await f.service().recover(f.target)).toMatchObject({success:false,failure:'PROVIDER_STATE_AMBIGUOUS'});expect(f.revoke).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
  });

  it('enforces unresolved uniqueness, provider-ID uniqueness and immutable journal identity',async()=>{
    const f=await fixture();f.inspect.mockRejectedValue(new Error('offline'));await f.service().recover(f.target);const j=await f.journal();
    const data={studentId:f.id,email:f.email,provider:'clerk',invitationId:f.invitation.id,oldProviderInvitationId:f.old};
    await expect(p.invitationRecovery.create({data})).rejects.toThrow();
    await expect(p.invitationRecovery.update({where:{id:j.id},data:{email:'changed@example.test'}})).rejects.toThrow();
    await p.invitationRecovery.update({where:{id:j.id},data:{replacementProviderInvitationId:`inv_fixed${f.old.slice(4)}`}});
    await expect(p.invitationRecovery.update({where:{id:j.id},data:{replacementProviderInvitationId:'inv_changed'}})).rejects.toThrow();
    await p.previewInvitation.update({where:{id:f.invitation.id},data:{providerInvitationId:`inv_different${f.old.slice(4)}`}});
    await expect(p.invitationRecovery.create({data:{...data,oldProviderInvitationId:`inv_different${f.old.slice(4)}`}})).rejects.toThrow();
    expect(await f.service().recover({...f.target,oldInvitationId:`inv_different${f.old.slice(4)}`})).toMatchObject({failure:'PRECONDITION_FAILED'});
    await expect(p.previewInvitation.delete({where:{id:f.invitation.id}})).rejects.toThrow();
  });

  it('preserves normal SENT invitation idempotency',async()=>{
    const f=await fixture(),createInvitation=vi.fn();
    const service=new PreviewProvisioningService(p,{invitations:{createInvitation}} as never,redirect);
    expect((await service.invite({studentId:f.id,email:f.email,displayName:'Disposable'})).id).toBe(f.invitation.id);expect(createInvitation).not.toHaveBeenCalled();
  });

  // Opt in only after provisioning the two named roles in disposable PostgreSQL.
  it.runIf(process.env.RECOVERY_ROLE_VALIDATION==='true')('keeps journal mutations operator-only while runtime exchange can read recovery state',async()=>{
    const runtimeUrl=new URL(url!),deployUrl=new URL(url!);
    runtimeUrl.username='bbb_preview_runtime_lp';deployUrl.username='bbb_preview_deploy_lp';
    const runtime=new PrismaClient({datasources:{db:{url:runtimeUrl.toString()}}});
    const deploy=new PrismaClient({datasources:{db:{url:deployUrl.toString()}}});
    try{
      await deploy.$transaction(tx=>applyPreviewRuntimeGrants(tx));
      const roles=await p.$queryRaw<{rolname:string;rolsuper:boolean;rolcreatedb:boolean;rolcreaterole:boolean;rolbypassrls:boolean}[]>`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname IN ('bbb_preview_runtime_lp','bbb_preview_deploy_lp')`;
      expect(roles).toHaveLength(2);
      for(const role of roles)expect([role.rolsuper,role.rolcreatedb,role.rolcreaterole,role.rolbypassrls]).toEqual([false,false,false,false]);
      const f=await fixture();f.inspect.mockRejectedValueOnce(new Error('offline'));
      const service=new InvitationRecoveryService(deploy,f.provider,redirect);
      expect((await service.recover(f.target)).success).toBe(false);
      const j=await f.journal();
      expect(await runtime.invitationRecovery.count({where:{id:j.id}})).toBe(1);
      await expect(runtime.invitationRecovery.update({where:{id:j.id},data:{failure:'PRECONDITION_FAILED'}})).rejects.toThrow();
      await expect(runtime.invitationRecovery.create({data:{studentId:f.id,email:f.email,provider:'clerk',invitationId:f.invitation.id,oldProviderInvitationId:f.old}})).rejects.toThrow();
      for(const statement of ['DELETE FROM invitation_recoveries WHERE false','TRUNCATE invitation_recoveries','CREATE SCHEMA recovery_forbidden','CREATE TABLE public.recovery_forbidden(id int)','CREATE ROLE recovery_forbidden','CREATE DATABASE recovery_forbidden','DELETE FROM case_templates WHERE false','ALTER TABLE invitation_recoveries DISABLE TRIGGER invitation_recovery_history_guard'])await expect(runtime.$executeRawUnsafe(statement)).rejects.toThrow();
      const memberships=await p.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('bbb_preview_runtime_lp','bbb_preview_deploy_lp')`;
      expect(memberships[0].count).toBe(0n);
      const auth=new PreviewIdentityService(runtime,300);
      expect(await auth.exchange(request,{provider:'clerk',subject:`user_${f.id}`,email:f.email})).toBeNull();
      expect((await service.recover(f.target)).success).toBe(true);
      expect((await f.journal()).status).toBe('COMPLETED');
      expect(await auth.exchange(request,{provider:'clerk',subject:`user_${f.id}`,email:f.email})).not.toBeNull();
      const permissions=await p.$queryRaw<{privilege_type:string}[]>`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='bbb_preview_runtime_lp' AND table_name='invitation_recoveries' ORDER BY privilege_type`;
      expect(permissions).toEqual([{privilege_type:'SELECT'}]);
    }finally{await runtime.$disconnect();await deploy.$disconnect();}
  });

  it.each(['CLAIMED','OLD_REVOCATION_PENDING','OLD_REVOKED','REPLACEMENT_CREATE_PENDING','REPLACEMENT_IDENTIFIED','LOCAL_RECONCILIATION_PENDING'] as const)('resumes a process restart at %s using durable evidence',async phase=>{
    const f=await fixture();
    const j=await p.invitationRecovery.create({data:{studentId:f.id,email:f.email,provider:'clerk',invitationId:f.invitation.id,oldProviderInvitationId:f.old,phase}});
    if(phase!=='CLAIMED')f.rows[0].status='revoked';
    const created=['REPLACEMENT_CREATE_PENDING','REPLACEMENT_IDENTIFIED','LOCAL_RECONCILIATION_PENDING'].includes(phase);
    if(created){
      const id=`inv_resumed${f.old.slice(4)}`;
      f.rows.push({id,email:f.email,status:'pending',recoveryId:j.id});
      if(phase!=='REPLACEMENT_CREATE_PENDING')await p.invitationRecovery.update({where:{id:j.id},data:{replacementProviderInvitationId:id}});
    }
    expect(await new PreviewIdentityService(p,300).exchange(request,{provider:'clerk',subject:`user_${f.id}`,email:f.email})).toBeNull();
    await noLifecycle(f.id);
    expect((await f.service().recover(f.target)).success).toBe(true);
    expect(f.revoke).toHaveBeenCalledTimes(phase==='CLAIMED'?1:0);
    expect(f.create).toHaveBeenCalledTimes(created?0:1);
    await noLifecycle(f.id);
  });
});
