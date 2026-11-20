import { execFileSync } from 'node:child_process';
import { MigrationProcessError, runReadOnlyPrismaProbe, type MigrationFailure } from './fence-migration-process.js';
import { strictPreviewDatabaseUrl } from './strict-preview-connection.js';
import { requireGate } from './recovery-workflow.js';
import { validateDispatch, validateIdleRuns } from './release-fence-install.js';

const failureExits:Record<MigrationFailure,number>={
  MIGRATION_SUBPROCESS_START_FAILED:11,
  MIGRATION_SUBPROCESS_SIGNALLED:12,
  MIGRATION_TIMEOUT:13,
  MIGRATION_CONNECTION_FAILED:14,
  MIGRATION_TLS_FAILED:15,
  MIGRATION_SQL_FAILED:16,
  MIGRATION_CONFIGURATION_FAILED:17,
  MIGRATION_HISTORY_FAILED:18,
  MIGRATION_ENGINE_FAILED:19,
  MIGRATION_UNKNOWN_FAILED:20,
  MIGRATION_DEPENDENCIES_MISMATCH:22,
};

async function verifySourceAndIdle(env:NodeJS.ProcessEnv) {
  validateDispatch(env);
  requireGate(env.GITHUB_REF_PROTECTED==='true' && env.GH_TOKEN && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID??''));
  const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  requireGate(git(['rev-parse','HEAD'])===env.APPROVED_SHA);
  requireGate(git(['status','--porcelain','--untracked-files=no'])==='');
  const read=async(path:string)=>{
    const response=await fetch('https://api.github.com/repos/buzztimothy/QB-Practice-Lab/'+path,{
      headers:{Authorization:`Bearer ${env.GH_TOKEN}`,Accept:'application/vnd.github+json'},
      signal:AbortSignal.timeout(30_000),redirect:'error',
    });
    requireGate(response.ok);
    return response.json();
  };
  const main=await read('branches/main') as {protected:boolean;commit:{sha:string}};
  requireGate(main.protected===true && main.commit.sha===env.APPROVED_SHA);
  for(const status of ['queued','in_progress','waiting','pending','requested']) {
    const runs=await read(`actions/runs?status=${status}&per_page=100`) as {total_count:number;workflow_runs:{id:number}[]};
    validateIdleRuns(runs,env.GITHUB_RUN_ID!);
  }
}

// Return only fixed exit classifications. The workflow suppresses all Node output.
export async function previewPrismaProbe(env:NodeJS.ProcessEnv):Promise<number> {
  try { await verifySourceAndIdle(env); }
  catch { return 10; }
  let url:string;
  try { url=strictPreviewDatabaseUrl(env.DIRECT_DATABASE_URL??'',env.PREVIEW_DATABASE_HOST); }
  catch { return 21; }
  try { await runReadOnlyPrismaProbe(url,env); }
  catch(error) { return error instanceof MigrationProcessError?failureExits[error.classification]:20; }
  try { await verifySourceAndIdle(env); }
  catch { return 10; }
  return 0;
}
