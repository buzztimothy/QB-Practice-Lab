import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Prisma, PrismaClient } from '@prisma/client';
import { requireGate } from './recovery-workflow.js';

export const fenceMigration = '202610220001_preview_release_fence';
export const freezeConfirmation = 'ALL_OPERATORS_IDLE_FREEZE_UNTIL_VERIFIED';
export interface LedgerRow {migration_name:string;checksum:string;finished_at:Date|null;rolled_back_at:Date|null}
export function migrationFiles(root='prisma/migrations') {
  return readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>({name:e.name,checksum:createHash('sha256').update(readFileSync(`${root}/${e.name}/migration.sql`)).digest('hex')}));
}
export function validateLedger(rows:LedgerRow[], files:{name:string;checksum:string}[], installed=false) {
  requireGate(files.length === 6 && files.filter(f=>f.name===fenceMigration).length===1);
  requireGate(new Set(rows.map(r=>r.migration_name)).size===rows.length);
  for(const row of rows) requireGate(row.finished_at && !row.rolled_back_at && files.some(f=>f.name===row.migration_name && f.checksum===row.checksum));
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
export async function verifyInstalled(db:PrismaClient) {
  validateLedger(await db.$queryRaw<LedgerRow[]>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations`,migrationFiles(),true);
  const rows=await db.$queryRaw<{valid:boolean}[]>`SELECT id='preview' AND NOT held AND owner IS NULL AND operation IS NULL AND acquired_at IS NULL AND released_at IS NULL AS valid FROM preview_release_fence`;
  requireGate(rows.length===1 && rows[0].valid);
  const [permissions]=await db.$queryRaw<{valid:boolean}[]>`SELECT has_table_privilege('bbb_preview_runtime_lp','preview_release_fence','SELECT') AND NOT has_table_privilege('bbb_preview_runtime_lp','preview_release_fence','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT has_schema_privilege('bbb_preview_runtime_lp','public','CREATE') AND (SELECT tableowner='bbb_preview_deploy_lp' FROM pg_tables WHERE schemaname='public' AND tablename='preview_release_fence') AS valid`;
  requireGate(permissions.valid);
}
