import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Prisma, PrismaClient } from '@prisma/client';
import { requireGate } from './recovery-workflow.js';

export const fenceMigration = '202610220001_preview_release_fence';
export const freezeConfirmation = 'ALL_OPERATORS_IDLE_FREEZE_UNTIL_VERIFIED';
export interface LedgerRow {migration_name:string;checksum:string;finished_at:Date|null;rolled_back_at:Date|null}
// Approved Git blob hashes and independently observed Preview ledger hashes.
const historicalChecksums = new Map([
  ['202608190001_p000a_operations', {
    lf: 'fb0e4cd492b8f2328aabff1787104de059c245384f0daa789f46e73fb8daa4e0',
    crlf: 'e016c75003f07d131ad47bf6d8b45a48ce7535c0220f26046bed3fd2d4fda1ea',
  }],
  ['202608270001_d000_durable_runtime', {
    lf: '4c49ab1c6dba2b382949f4a6093ec7cff5c94dbaeaf7e40df97cfc81f9f32ea7',
    crlf: '1e60640ce01cdb6cd7bb5ea924e45054f6be3b39786bc92b1593aedeb8486d22',
  }],
  ['202608280001_d002_preview_auth', {
    lf: 'f7cb374dc7fa210d101acfe9ca36a91e53c3cb67f81d883fca1fba61c7f9ce26',
    crlf: 'af18c9291b58bcabed8ecc3d8ef297b7ccbd218b41632cb22d3ec083b0847e53',
  }],
]);
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
interface MigrationFile {name:string;checksum:string;compatibleChecksum?:string}

export function migrationFiles(root='prisma/migrations') {
  return readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()).map(({name}):MigrationFile=>{
    const bytes=readFileSync(`${root}/${name}/migration.sql`);
    const checksum=sha256(bytes);
    const pinned=historicalChecksums.get(name);
    if(pinned && checksum===pinned.lf && sha256(bytes.toString('utf8').replaceAll('\n','\r\n'))===pinned.crlf) {
      return {name,checksum,compatibleChecksum:pinned.crlf};
    }
    return {name,checksum};
  });
}
export function validateLedger(rows:LedgerRow[], files:MigrationFile[], installed=false) {
  requireGate(files.length === 6 && files.filter(f=>f.name===fenceMigration).length===1);
  requireGate(new Set(rows.map(r=>r.migration_name)).size===rows.length);
  for(const row of rows) {
    const file=files.find(f=>f.name===row.migration_name);
    const pinned=historicalChecksums.get(row.migration_name);
    const matches=pinned && row.checksum===pinned.crlf
      ? file?.checksum===pinned.lf && file.compatibleChecksum===pinned.crlf
      : file?.checksum===row.checksum;
    requireGate(row.finished_at && !row.rolled_back_at && matches);
  }
  const pending=files.filter(f=>!rows.some(r=>r.migration_name===f.name));
  requireGate(installed ? pending.length===0 : pending.length===1 && pending[0].name===fenceMigration);
}
export function validateDispatch(env:NodeJS.ProcessEnv) {
  requireGate(env.GITHUB_REPOSITORY==='buzztimothy/QB-Practice-Lab' && env.GITHUB_REF==='refs/heads/main');
  requireGate(env.GITHUB_EVENT_NAME==='workflow_dispatch' && env.GITHUB_RUN_ATTEMPT==='1');
  requireGate(/^[a-f0-9]{40}$/.test(env.APPROVED_SHA??'') && env.APPROVED_SHA===env.GITHUB_SHA);
  requireGate(env.OPERATOR_FREEZE===freezeConfirmation);
}
export function validateIdleRuns(result:{total_count:number;workflow_runs:{id:number}[]},currentRun:string) {
  requireGate(result.total_count===result.workflow_runs.length && result.workflow_runs.every(r=>String(r.id)===currentRun));
}
export async function verifyDatabaseIdle(tx:Prisma.TransactionClient) {
  // Application runtime stays available; unobservable operator sessions block.
  const [state]=await tx.$queryRaw<{clear:boolean}[]>`SELECT NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid<>pg_backend_pid()) AND NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND usename IS DISTINCT FROM 'bbb_preview_runtime_lp' AND (state IS NULL OR state NOT IN ('idle')) ) AS clear`;
  requireGate(state.clear);
}
// Unlike recovery integrity, protect every invitation column and all journal rows.
export async function installIntegrity(db:PrismaClient) {
  return db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const tables=await tx.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','preview_release_fence') ORDER BY tablename`;
    const summary=[];
    for(const {tablename} of tables){
      const name='"'+tablename.replaceAll('"','""')+'"';
      const rows=await tx.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),'')) AS digest FROM ${name} t`);
      summary.push({table:tablename,rows});
    }
    return createHash('sha256').update(JSON.stringify(summary)).digest('hex');
  });
}
export async function verifyInstalled(db:PrismaClient, files=migrationFiles()) {
  validateLedger(await db.$queryRaw<LedgerRow[]>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations`,files,true);
  const rows=await db.$queryRaw<{valid:boolean}[]>`SELECT id='preview' AND NOT held AND owner IS NULL AND operation IS NULL AND acquired_at IS NULL AND released_at IS NULL AS valid FROM preview_release_fence`;
  requireGate(rows.length===1 && rows[0].valid);
  const [permissions]=await db.$queryRaw<{valid:boolean}[]>`SELECT has_table_privilege('bbb_preview_runtime_lp','preview_release_fence','SELECT') AND NOT has_table_privilege('bbb_preview_runtime_lp','preview_release_fence','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT has_schema_privilege('bbb_preview_runtime_lp','public','CREATE') AND (SELECT tableowner='bbb_preview_deploy_lp' FROM pg_tables WHERE schemaname='public' AND tablename='preview_release_fence') AS valid`;
  requireGate(permissions.valid);
}
