import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { RecoveryProviderState } from '../apps/web/invitation-recovery-provider.js';

export const recoveryScope = Object.freeze({
  studentId: 'd003-student-26664e0d-446f-4492-89de-f37e5d872292',
  controlId: 'd003-student-05dbe238-fe81-4578-86bc-2fcb31fab9cf',
  oldInvitationId: 'inv_3JSadnQYTpN5k38Kcuns1OWeCQk',
  email: 'tim.buzzelli@buzzbooksllc.com',
  instanceId: 'ins_3IjC30Mkgc6IcgFSbN6n7Db0jNm',
  databaseHost: 'ep-lively-snow-ayhwi8xr.c-5.us-east-2.aws.neon.tech',
  migration: '202609210001_invitation_recovery_journal',
});
export function requireGate(condition: unknown): asserts condition {
  if (!condition) throw new Error('RECOVERY_GATE_REJECTED');
}
export function workflowMode(env: NodeJS.ProcessEnv) {
  requireGate(env.GITHUB_REPOSITORY === 'buzztimothy/QB-Practice-Lab' && env.GITHUB_REF === 'refs/heads/main');
  requireGate(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_RUN_ATTEMPT === '1');
  requireGate(/^[a-f0-9]{40}$/.test(env.APPROVED_SHA ?? '') && env.APPROVED_SHA === env.GITHUB_SHA);
  requireGate(env.RECOVERY_MODE === 'preflight' || env.RECOVERY_MODE === 'execute');
  requireGate(env.RECOVERY_MODE === 'preflight' || env.RECOVERY_CONFIRM === recoveryScope.studentId);
  return env.RECOVERY_MODE;
}
export interface PriorRun {
  id:number; workflow_id:number; run_attempt:number; event:string; head_sha:string; head_branch:string;
  path:string; status:string; conclusion:string; repository:{full_name:string}; head_repository:{full_name:string};
}
export interface PriorJobs {
  total_count:number;
  jobs: {run_id:number;run_attempt:number;head_sha:string;name:string;status:string;conclusion:string;steps:{name:string;status:string;conclusion:string}[]}[];
}
export function validatePriorRun(run:PriorRun, workflow:{id:number;path:string;state:string}, jobs:PriorJobs, sha:string, currentRun:string, requestedRun:string) {
  requireGate(String(run.id) === requestedRun && String(run.id) !== currentRun && run.run_attempt === 1 && run.event === 'workflow_dispatch');
  requireGate(run.repository.full_name === 'buzztimothy/QB-Practice-Lab' && run.head_repository.full_name === run.repository.full_name);
  requireGate(workflow.state === 'active' && workflow.path === '.github/workflows/preview-recovery.yml' && run.workflow_id === workflow.id);
  requireGate(run.head_sha === sha && run.head_branch === 'main' && run.path === '.github/workflows/preview-recovery.yml');
  requireGate(run.status === 'completed' && run.conclusion === 'success');
  // Job/step metadata is produced by the reviewed workflow at the pinned SHA.
  // A renamed display title cannot turn an execute or skipped job into preflight.
  requireGate(jobs.total_count === 1 && jobs.jobs.length === 1);
  const job = jobs.jobs[0];
  requireGate(job.run_id === run.id && job.run_attempt === 1 && job.head_sha === sha && job.name === 'recovery preflight');
  requireGate(job.status === 'completed' && job.conclusion === 'success');
  for (const name of ['Guarded preflight or single recovery operation','Record successful read-only preflight']) {
    const steps = job.steps.filter(step => step.name === name);
    requireGate(steps.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success');
  }
}
export function validateClerkIdentity(instance: {id:string;environmentType:string}, domains: {totalCount:number;data:readonly {frontendApiUrl:string;accountsPortalUrl?:string|null}[]}, env:NodeJS.ProcessEnv) {
  requireGate(instance.id === recoveryScope.instanceId && instance.environmentType === 'production');
  requireGate(env.CLERK_INSTANCE_ID === recoveryScope.instanceId && domains.totalCount === domains.data.length);
  const issuer = new URL(env.CLERK_ISSUER!);
  const portal = new URL(env.CLERK_SIGN_IN_URL!);
  requireGate(issuer.protocol === 'https:' && issuer.href === `${issuer.origin}/`);
  requireGate(domains.data.some(d => new URL(d.frontendApiUrl).origin === issuer.origin && !!d.accountsPortalUrl && new URL(d.accountsPortalUrl).origin === portal.origin));
  const key = env.CLERK_PUBLISHABLE_KEY ?? '';
  requireGate(key.startsWith('pk_live_'));
  requireGate(Buffer.from(key.slice(8), 'base64').toString() === `${issuer.host}$`);
}
export function validateInventory(state:RecoveryProviderState, replacement?:{id:string;operationId:string}) {
  requireGate(state.users === 0);
  const old = state.invitations.filter(i => i.id === recoveryScope.oldInvitationId);
  requireGate(old.length === 1 && old[0].email === recoveryScope.email);
  requireGate(state.invitations.every(i => i.email === recoveryScope.email && ['pending','revoked','expired'].includes(i.status)));
  if (!replacement) {
    requireGate(old[0].status === 'pending' && !old[0].recoveryId);
    requireGate(state.invitations.filter(i => i.status === 'pending').length === 1);
    requireGate(!state.invitations.some(i => i.recoveryId));
  } else {
    requireGate(['revoked','expired'].includes(old[0].status));
    const pending = state.invitations.filter(i => i.status === 'pending');
    requireGate(pending.length === 1 && pending[0].id === replacement.id && pending[0].recoveryId === replacement.operationId);
  }
}

// Hash rows inside PostgreSQL: no email, identity, session or payload leaves the DB.
// Catalog names are quoted, not interpreted as SQL fragments supplied by an operator.
export async function integrity(prisma:PrismaClient) {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const tables = await tx.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','invitation_recoveries','preview_release_fence') ORDER BY tablename`;
    const summary:unknown[] = [];
    for (const {tablename} of tables) {
      const name = '"' + tablename.replaceAll('"','""') + '"';
      // Only the target's provider reference/updatedAt may change. Its other fields remain protected.
      const row = tablename === 'preview_invitations' ? `CASE WHEN t.student_id = '${recoveryScope.studentId}' THEN to_jsonb(t)-'provider_invitation_id'-'updated_at' ELSE to_jsonb(t) END` : 'to_jsonb(t)';
      const result = await tx.$queryRawUnsafe<{count:string;digest:string}[]>(`SELECT count(*)::text AS count,md5(coalesce(string_agg((${row})::text,chr(10) ORDER BY (${row})::text),'')) AS digest FROM ${name} t`);
      summary.push({table:tablename,...result[0]});
    }
    return createHash('sha256').update(JSON.stringify(summary)).digest('hex');
  });
}
export async function databaseIdentity(prisma:PrismaClient) {
  const [identity] = await prisma.$queryRaw<{database:string;role:string;safe:boolean}[]>`SELECT current_database() AS database,current_user AS role,NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls) AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS safe FROM pg_roles r WHERE rolname=current_user`;
  requireGate(identity?.database === 'bbb_practice_preview' && identity.role === 'bbb_preview_deploy_lp' && identity.safe);
  const [migration] = await prisma.$queryRaw<{valid:boolean}[]>`SELECT count(*)=1 AND bool_and(finished_at IS NOT NULL AND rolled_back_at IS NULL) AS valid FROM _prisma_migrations WHERE migration_name=${recoveryScope.migration}`;
  requireGate(migration.valid);
  const [permissions] = await prisma.$queryRaw<{valid:boolean}[]>`SELECT has_table_privilege('bbb_preview_runtime_lp','invitation_recoveries','SELECT') AND NOT has_table_privilege('bbb_preview_runtime_lp','invitation_recoveries','INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_schema_privilege('bbb_preview_runtime_lp','public','CREATE') AS valid`;
  requireGate(permissions.valid);
}
export async function eligibility(prisma:PrismaClient, replacementId:string = recoveryScope.oldInvitationId) {
  const student = await prisma.runtimeStudent.findUnique({where:{id:recoveryScope.studentId}});
  const invitations = await prisma.previewInvitation.findMany({where:{studentId:recoveryScope.studentId}});
  const invitation = invitations[0];
  requireGate(student?.status === 'INVITED' && student.email === recoveryScope.email);
  requireGate(invitations.length === 1 && invitation.status === 'SENT' && invitation.provider === 'clerk' && invitation.email === recoveryScope.email);
  requireGate(invitation.providerInvitationId === replacementId && !invitation.consumedAt && !invitation.consumedSubject);
  for (const id of [recoveryScope.studentId,recoveryScope.controlId]) {
    requireGate(await prisma.externalIdentityLink.count({where:{studentId:id}}) === 0);
    requireGate(await prisma.studentSession.count({where:{studentId:id}}) === 0);
    requireGate(await prisma.runtimeAttempt.count({where:{studentId:id}}) === 0);
    requireGate(await prisma.studentAttempt.count({where:{studentId:id}}) === 0);
  }
  requireGate(await prisma.runtimeStudent.count({where:{id:recoveryScope.controlId}}) === 0);
  requireGate(await prisma.previewInvitation.count({where:{studentId:recoveryScope.controlId}}) === 0);
  return invitation.id;
}

export interface RecoveryWorkflowActions {
  preflight():Promise<void>;
  invokeCli():Promise<void>;
  postcheck():Promise<void>;
}
export async function runRecoveryMode(mode:'preflight'|'execute', actions:RecoveryWorkflowActions) {
  await actions.preflight();
  if (mode === 'preflight') return;
  // Deliberately no retry, including after unknown child-process outcomes.
  await actions.invokeCli();
  await actions.postcheck();
}
