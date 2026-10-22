import { execFileSync, spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import { ClerkInvitationRecoveryProvider } from '../apps/web/invitation-recovery-provider.js';
import { recoveryConfiguration } from './preview-invitation-recovery.js';
import { databaseIdentity, eligibility, integrity, recoveryScope, requireGate, runRecoveryMode, validateClerkIdentity, validateInventory, validatePriorRun, workflowMode } from './recovery-workflow.js';

let prisma:PrismaClient|undefined;
let stage = 'SOURCE';
try {
  const env = process.env;
  const mode = workflowMode(env);
  const verifySource = () => {
    const head = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    const remote = execFileSync('git',['ls-remote','origin','refs/heads/main'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim().split(/\s+/)[0];
    requireGate(head === env.APPROVED_SHA && remote === head);
  };
  verifySource();
  if (mode === 'execute') {
    stage = 'PRIOR_PREFLIGHT';
    requireGate(/^[0-9]+$/.test(env.PREFLIGHT_RUN_ID ?? ''));
    const response = await fetch(`https://api.github.com/repos/buzztimothy/QB-Practice-Lab/actions/runs/${env.PREFLIGHT_RUN_ID}`, {
      headers:{Authorization:`Bearer ${env.GH_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30_000),redirect:'error',
    });
    requireGate(response.ok);
    validatePriorRun(await response.json(), env.APPROVED_SHA!, env.GITHUB_RUN_ID!);
  }
  stage = 'CONFIGURATION';
  requireGate(env.PREVIEW_DATABASE_HOST === recoveryScope.databaseHost);
  requireGate(env.DATABASE_URL === env.DATABASE_URL?.trim());
  const config = recoveryConfiguration(env);
  const clerk = createClerkClient({secretKey:config.clerk.secretKey});
  const provider = new ClerkInvitationRecoveryProvider(clerk);
  stage = 'CLERK_IDENTITY';
  validateClerkIdentity(await clerk.instance.get(), await clerk.domains.list(), env);
  prisma = new PrismaClient({datasources:{db:{url:config.databaseUrl}}});
  const db = prisma;
  stage = 'DATABASE_IDENTITY';
  await databaseIdentity(db);
  // Same session lock as deployment; no deployment workflow change needed.
  await db.$transaction(async lock => {
    stage = 'RELEASE_LOCK';
    const [row] = await lock.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_lock(6982806162030449104) AS locked`;
    requireGate(row.locked);
    try {
      let before = '', invitationId = '';
      await runRecoveryMode(mode, {
        async preflight() {
          stage = 'ELIGIBILITY';
          requireGate(await db.invitationRecovery.count() === 0);
          invitationId = await eligibility(db);
          validateInventory(await provider.inspect(recoveryScope.email));
          before = await integrity(db);
        },
        async invokeCli() {
          stage = 'FINAL_GUARDS';
          verifySource();
          await databaseIdentity(db);
          await eligibility(db);
          requireGate(await db.invitationRecovery.count() === 0 && await integrity(db) === before);
          validateClerkIdentity(await clerk.instance.get(), await clerk.domains.list(), env);
          validateInventory(await provider.inspect(recoveryScope.email));
          stage = 'RECOVERY_CLI';
          const childEnv = {...env};
          delete childEnv.GH_TOKEN; delete childEnv.GITHUB_TOKEN;
          await new Promise<void>((resolve,reject) => {
            const child = spawn(process.execPath,['dist/scripts/recover-preview-invitation.js','--student-id',recoveryScope.studentId,'--confirm',recoveryScope.studentId,'--old-invitation-id',recoveryScope.oldInvitationId],{env:childEnv,stdio:'ignore',timeout:120_000});
            child.once('error',()=>reject(new Error('CLI_FAILED')));
            child.once('exit',(code)=>code === 0 ? resolve() : reject(new Error('CLI_FAILED')));
          });
        },
        async postcheck() {
          stage = 'POSTCHECK';
          const rows = await db.invitationRecovery.findMany();
          const journal = rows[0];
          requireGate(rows.length === 1 && journal.status === 'COMPLETED' && journal.phase === 'COMPLETED' && journal.completedAt && !journal.failure);
          requireGate(journal.studentId === recoveryScope.studentId && journal.invitationId === invitationId && journal.oldProviderInvitationId === recoveryScope.oldInvitationId);
          requireGate(journal.replacementProviderInvitationId && journal.replacementProviderInvitationId !== recoveryScope.oldInvitationId);
          requireGate(await eligibility(db,journal.replacementProviderInvitationId) === invitationId);
          validateInventory(await provider.inspect(recoveryScope.email),{id:journal.replacementProviderInvitationId,operationId:journal.id});
          requireGate(await integrity(db) === before);
          await databaseIdentity(db);
        },
      });
    } finally { await lock.$queryRaw`SELECT pg_advisory_unlock(6982806162030449104)`; }
  },{timeout:600_000});
  console.log(JSON.stringify({success:true,mode,studentId:recoveryScope.studentId,classification:mode === 'preflight' ? 'PREFLIGHT_PASSED' : 'RECOVERY_VERIFIED'}));
} catch {
  // Never print provider errors, child stdout, connection strings or request/response objects.
  console.error(JSON.stringify({success:false,status:'BLOCKED',stage,classification:'INSPECTION_REQUIRED_NO_RETRY'}));
  process.exitCode = 1;
} finally {
  try { await prisma?.$disconnect(); } catch { process.exitCode = 1; }
}
