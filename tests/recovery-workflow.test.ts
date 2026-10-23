import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { recoveryScope, runRecoveryMode, validateClerkIdentity, validateInventory, validatePriorRun, workflowMode } from '../scripts/recovery-workflow.js';

const sha='a'.repeat(40);
const env={GITHUB_REPOSITORY:'buzztimothy/QB-Practice-Lab',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:sha,APPROVED_SHA:sha,RECOVERY_MODE:'preflight'};
const old={id:recoveryScope.oldInvitationId,email:recoveryScope.email,status:'pending'};
describe('protected recovery workflow',()=>{
  it('requires this repository, main, exact SHA, manual first attempt and explicit execute confirmation',()=>{
    expect(workflowMode(env)).toBe('preflight');
    expect(workflowMode({...env,RECOVERY_MODE:'execute',RECOVERY_CONFIRM:recoveryScope.studentId})).toBe('execute');
    for(const change of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_EVENT_NAME:'push'},{GITHUB_RUN_ATTEMPT:'2'},{APPROVED_SHA:'b'.repeat(40)},{RECOVERY_MODE:'anything'},{RECOVERY_MODE:'execute'},{RECOVERY_MODE:'execute',RECOVERY_CONFIRM:'all'}])expect(()=>workflowMode({...env,...change})).toThrow('RECOVERY_GATE_REJECTED');
  });
  it('accepts only a separate successful original preflight dispatch at the same SHA',()=>{
    const run={id:1,workflow_id:77,run_attempt:1,event:'workflow_dispatch',head_sha:sha,head_branch:'main',path:'.github/workflows/preview-recovery.yml',display_title:`Preview recovery preflight ${sha}`,status:'completed',conclusion:'success',repository:{full_name:'buzztimothy/QB-Practice-Lab'},head_repository:{full_name:'buzztimothy/QB-Practice-Lab'}};
    const workflow={id:77,path:run.path,state:'active'};
    const job={run_id:1,run_attempt:1,head_sha:sha,name:'recovery preflight',status:'completed',conclusion:'success',steps:['Guarded preflight or single recovery operation','Record successful read-only preflight'].map(name=>({name,status:'completed',conclusion:'success'}))};
    const jobs={total_count:1,jobs:[job]};
    expect(()=>validatePriorRun(run,workflow,jobs,sha,'2','1')).not.toThrow();
    for(const change of [{id:2},{workflow_id:78},{run_attempt:2},{event:'push'},{head_sha:'b'.repeat(40)},{head_branch:'other'},{path:'.github/workflows/preview-deploy.yml'},{status:'in_progress'},{conclusion:'failure'},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'other/fork'}}])expect(()=>validatePriorRun({...run,...change},workflow,jobs,sha,'2','1')).toThrow();
    // Spoofed/renamed display_title is never evidence of successful preflight.
    expect(()=>validatePriorRun(run,workflow,{total_count:1,jobs:[{...job,name:'recovery execute'}]},sha,'2','1')).toThrow();
    expect(()=>validatePriorRun(run,workflow,{total_count:1,jobs:[{...job,steps:[]}]},sha,'2','1')).toThrow();
    expect(()=>validatePriorRun(run,workflow,{total_count:1,jobs:[{...job,steps:job.steps.map(s=>({...s,conclusion:'skipped'}))}]},sha,'2','1')).toThrow();
    expect(()=>validatePriorRun(run,workflow,{total_count:2,jobs:[job]},sha,'2','1')).toThrow();
    expect(()=>validatePriorRun(run,workflow,jobs,sha,'2','999')).toThrow();
    expect(()=>validatePriorRun(run,{...workflow,id:78},jobs,sha,'2','1')).toThrow();
  });
  it('pins authenticated Clerk instance, production classification, complete domain inventory and publishable key host',()=>{
    const instance={id:recoveryScope.instanceId,environmentType:'production'};
    const domains={totalCount:1,data:[{frontendApiUrl:'https://clerk.preview.example',accountsPortalUrl:'https://accounts.preview.example'}]};
    const config={CLERK_INSTANCE_ID:recoveryScope.instanceId,CLERK_ISSUER:'https://clerk.preview.example',CLERK_SIGN_IN_URL:'https://accounts.preview.example/sign-in',CLERK_PUBLISHABLE_KEY:`pk_live_${Buffer.from('clerk.preview.example$').toString('base64')}`};
    expect(()=>validateClerkIdentity(instance,domains,config)).not.toThrow();
    expect(()=>validateClerkIdentity({...instance,id:'ins_unrelated'},domains,config)).toThrow();
    expect(()=>validateClerkIdentity({...instance,environmentType:'development'},domains,config)).toThrow();
    expect(()=>validateClerkIdentity(instance,{...domains,totalCount:2},config)).toThrow();
    expect(()=>validateClerkIdentity(instance,domains,{...config,CLERK_ISSUER:'https://unrelated.example'})).toThrow();
    expect(()=>validateClerkIdentity(instance,domains,{...config,CLERK_SIGN_IN_URL:'https://unrelated.example/sign-in'})).toThrow();
    expect(()=>validateClerkIdentity(instance,domains,{...config,CLERK_PUBLISHABLE_KEY:'pk_test_invalid'})).toThrow();
  });
  it('rejects users, consumed/missing invitations, conflicts and prior recovery evidence',()=>{
    expect(()=>validateInventory({users:0,invitations:[old]})).not.toThrow();
    for(const state of [{users:1,invitations:[old]},{users:0,invitations:[]},{users:0,invitations:[{...old,status:'accepted'}]},{users:0,invitations:[old,{...old,id:'inv_other'}]},{users:0,invitations:[{...old,recoveryId:'previous'}]}])expect(()=>validateInventory(state)).toThrow();
    expect(()=>validateInventory({users:0,invitations:[{...old,status:'revoked'},{...old,id:'inv_new',recoveryId:'operation'}]},{id:'inv_new',operationId:'operation'})).not.toThrow();
    expect(()=>validateInventory({users:0,invitations:[old]},{id:'inv_new',operationId:'operation'})).toThrow();
  });
  it('preflight never calls the CLI or post-mutation path',async()=>{
    const actions={preflight:vi.fn().mockResolvedValue(undefined),invokeCli:vi.fn(),postcheck:vi.fn()};
    await runRecoveryMode('preflight',actions);
    expect(actions.preflight).toHaveBeenCalledOnce();expect(actions.invokeCli).not.toHaveBeenCalled();expect(actions.postcheck).not.toHaveBeenCalled();
  });
  it('invokes once only after preflight; never retries failures',async()=>{
    const actions={preflight:vi.fn().mockResolvedValue(undefined),invokeCli:vi.fn().mockResolvedValue(undefined),postcheck:vi.fn().mockResolvedValue(undefined)};
    await runRecoveryMode('execute',actions);expect(actions.invokeCli).toHaveBeenCalledOnce();expect(actions.postcheck).toHaveBeenCalledOnce();
    actions.invokeCli.mockClear().mockRejectedValue(new Error('sensitive provider error'));actions.postcheck.mockClear();
    await expect(runRecoveryMode('execute',actions)).rejects.toThrow();expect(actions.invokeCli).toHaveBeenCalledOnce();expect(actions.postcheck).not.toHaveBeenCalled();
    actions.invokeCli.mockClear();actions.preflight.mockRejectedValue(new Error('blocked'));
    await expect(runRecoveryMode('execute',actions)).rejects.toThrow();expect(actions.invokeCli).not.toHaveBeenCalled();
  });
  it('keeps operator secrets step-scoped and the CLI output off the log',()=>{
    const workflow=readFileSync('.github/workflows/preview-recovery.yml','utf8');
    expect(workflow).toContain('default: preflight');expect(workflow).toContain('environment: bbb-preview-recovery');
    expect(workflow).toContain('group: bbb-preview-deploy');expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow.indexOf('secrets.DIRECT_DATABASE_URL')).toBeGreaterThan(workflow.indexOf('name: Guarded preflight'));
    expect(workflow).not.toMatch(/workflow_run:|pull_request:|schedule:|migrate deploy|preview:invite|upload-artifact/);
    const script=readFileSync('scripts/run-preview-recovery-workflow.ts','utf8');
    expect(script).toContain("stdio:'ignore'");expect(script).not.toContain('console.error(error)');
  });
});
