import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({
  urls:[] as string[],
  childEnvironment:undefined as NodeJS.ProcessEnv|undefined,
  sha:'a'.repeat(40),
}));

vi.mock('@prisma/client',async importOriginal=>{
  const actual=await importOriginal<typeof import('@prisma/client')>();
  return {...actual,PrismaClient:class {
    constructor(options:{datasources:{db:{url:string}}}) { fixture.urls.push(options.datasources.db.url); }
    invitationRecovery={count:async()=>0};
    async $queryRaw() { return [{ok:true,pid:1,valid:true}]; }
    async $transaction(action:(tx:this)=>Promise<void>) { return action(this); }
    async $disconnect() {}
  }};
});
vi.mock('node:child_process',()=>({
  execFileSync:(_command:string,args:string[])=>{
    if(args[0]==='status')return '';
    return args[0]==='ls-remote'?fixture.sha+'\trefs/heads/main':fixture.sha;
  },
  spawn:(_command:string,_args:string[],options:{env:NodeJS.ProcessEnv})=>{
    fixture.childEnvironment=options.env;
    const child=new EventEmitter();
    Object.assign(child,{stdout:new PassThrough(),stderr:new PassThrough()});
    queueMicrotask(()=>child.emit('close',0));
    return child;
  },
}));
vi.mock('../scripts/recovery-workflow.js',async importOriginal=>{
  const actual=await importOriginal<typeof import('../scripts/recovery-workflow.js')>();
  return {...actual,databaseIdentity:vi.fn(),eligibility:vi.fn()};
});
vi.mock('../scripts/release-fence-install.js',async importOriginal=>{
  const actual=await importOriginal<typeof import('../scripts/release-fence-install.js')>();
  return {...actual,validateLedger:vi.fn(),verifyDatabaseIdle:vi.fn(),verifyInstalled:vi.fn(),installIntegrity:async()=> 'unchanged'};
});
afterEach(()=>{
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('uses the same strict URL for both installer clients and the migration child',async()=>{
  const { recoveryScope }=await import('../scripts/recovery-workflow.js');
  const { strictPreviewDatabaseUrl }=await import('../scripts/strict-preview-connection.js');
  const raw=`postgresql://bbb_preview_deploy_lp:fixture@${recoveryScope.databaseHost}/bbb_practice_preview?sslmode=require`;
  const env={
    GITHUB_REPOSITORY:'buzztimothy/QB-Practice-Lab',GITHUB_REF:'refs/heads/main',
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'1',
    APPROVED_SHA:fixture.sha,GITHUB_SHA:fixture.sha,
    OPERATOR_FREEZE:'ALL_OPERATORS_IDLE_FREEZE_UNTIL_VERIFIED',
    DIRECT_DATABASE_URL:raw,PREVIEW_DATABASE_HOST:recoveryScope.databaseHost,
  };
  for(const [name,value] of Object.entries(env))vi.stubEnv(name,value);
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({total_count:1,workflow_runs:[{id:1}]})})));
  const output=vi.spyOn(console,'log').mockImplementation(()=>{});
  const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
  await import('../scripts/install-preview-release-fence.js');
  expect(errors).not.toHaveBeenCalled();
  const strict=strictPreviewDatabaseUrl(raw,recoveryScope.databaseHost);
  expect(fixture.urls).toEqual([strict,strict]);
  expect(fixture.childEnvironment?.DATABASE_URL).toBe(strict);
  expect(fixture.childEnvironment?.DIRECT_DATABASE_URL).toBeUndefined();
  expect(process.env.DIRECT_DATABASE_URL).toBe(raw);
  expect(output).toHaveBeenCalledOnce();
});
