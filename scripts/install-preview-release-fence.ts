import { execFileSync, spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assertPreviewDeployDatabase } from './database-target-guard.js';
import { databaseIdentity, eligibility, recoveryScope, requireGate } from './recovery-workflow.js';
import { previewReleaseLockKey } from './preview-release-lock.js';
import { installIntegrity, migrationFiles, validateDispatch, validateIdleRuns, validateLedger, verifyDatabaseIdle, verifyInstalled, type LedgerRow } from './release-fence-install.js';

let db:PrismaClient|undefined, lock:PrismaClient|undefined;
let stage='SOURCE';
try {
  const env=process.env;
  validateDispatch(env);
  const source=()=>{
    const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    requireGate(git(['rev-parse','HEAD'])===env.APPROVED_SHA);
    requireGate(git(['status','--porcelain','--untracked-files=no'])==='');
    requireGate(git(['ls-remote','origin','refs/heads/main']).split(/\s+/)[0]===env.APPROVED_SHA);
  };
  const idle=async()=>{
    // Inspect every non-completed repository run, not only the latest page.
    for(const status of ['queued','in_progress','waiting','pending','requested']){
      const response=await fetch(`https://api.github.com/repos/buzztimothy/QB-Practice-Lab/actions/runs?status=${status}&per_page=100`,{headers:{Authorization:`Bearer ${env.GH_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30_000),redirect:'error'});
      requireGate(response.ok);
      const result=await response.json() as {total_count:number;workflow_runs:{id:number}[]};
      validateIdleRuns(result,env.GITHUB_RUN_ID!);
    }
  };
  source(); await idle();
  stage='TARGET';
  requireGate(env.PREVIEW_DATABASE_HOST===recoveryScope.databaseHost);
  const url=env.DIRECT_DATABASE_URL!;
  assertPreviewDeployDatabase(url,'bbb_practice_preview',env.PREVIEW_DATABASE_HOST);
  const target=new URL(url);
  requireGate(!target.searchParams.has('options') && !target.searchParams.has('pgbouncer') && !target.searchParams.has('sslaccept'));
  requireGate(!target.searchParams.has('schema') || target.searchParams.get('schema')==='public');
  db=new PrismaClient({datasources:{db:{url}}});
  lock=new PrismaClient({datasources:{db:{url}}});
  const database=db;
  await databaseIdentity(database);
  stage='QUIESCENCE';
  // Bootstrap cannot use the durable helper until its tracked migration exists.
  // Maintain the owner freeze even on failure; this lock alone is not durable.
  await lock.$transaction(async tx=>{
    const [held]=await tx.$queryRaw<{ok:boolean;pid:number}[]>`SELECT pg_try_advisory_lock(${previewReleaseLockKey}) AS ok,pg_backend_pid() AS pid`;
    requireGate(held.ok);
    try {
      const gates=async()=>{
        source(); await idle(); await databaseIdentity(database); await eligibility(database);
        requireGate(await database.invitationRecovery.count()===0);
        validateLedger(await database.$queryRaw<LedgerRow[]>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations`,migrationFiles());
        const [absent]=await database.$queryRaw<{valid:boolean}[]>`SELECT to_regclass('public.preview_release_fence') IS NULL AS valid`;
        requireGate(absent.valid);
        await verifyDatabaseIdle(tx);
      };
      await gates();
      const before=await installIntegrity(database);
      await gates();
      requireGate(await installIntegrity(database)===before);
      stage='PRISMA_MIGRATE_DEPLOY';
      await new Promise<void>((resolve,reject)=>{
        const child=spawn('pnpm',['exec','prisma','migrate','deploy'],{env:{PATH:env.PATH,HOME:env.HOME,DATABASE_URL:url},stdio:'ignore',timeout:120_000});
        child.once('error',()=>reject(new Error('MIGRATION_FAILED')));
        child.once('close',code=>code===0?resolve():reject(new Error('MIGRATION_FAILED')));
      });
      stage='POSTCHECK';
      await tx.$queryRaw`SELECT pg_backend_pid()`;
      await verifyInstalled(database); await databaseIdentity(database); await eligibility(database);
      requireGate(await database.invitationRecovery.count()===0 && await installIntegrity(database)===before);
    } finally {
      const [released]=await tx.$queryRaw<{ok:boolean;pid:number}[]>`SELECT pg_advisory_unlock(${previewReleaseLockKey}) AS ok,pg_backend_pid() AS pid`;
      requireGate(released.ok && released.pid===held.pid);
    }
  },{timeout:240_000});
  console.log(JSON.stringify({success:true,migration:'202610220001_preview_release_fence',ledgerChecksum:true,singletonUnheld:true,runtimeReadOnly:true,integrityUnchanged:true}));
} catch {
  console.error(JSON.stringify({success:false,stage,status:'BLOCKED_INSPECTION_REQUIRED_NO_RETRY_KEEP_OPERATOR_FREEZE'}));
  process.exitCode=1;
} finally {
  await Promise.allSettled([db?.$disconnect(),lock?.$disconnect()]);
}
