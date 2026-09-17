import type { PrismaClient } from '@prisma/client';
import type { PreviewProvisioningService } from '../apps/web/preview-provisioning.js';
import { productionRuntimeConfiguration } from '../apps/web/runtime-configuration.js';
import { assertPreviewDeployDatabase } from './database-target-guard.js';

export function deactivationTarget(args: readonly string[]) {
  const values = new Map<string, string>();
  const input = args[0] === '--' ? args.slice(1) : args;
  if (input.length !== 4) throw new Error('Invalid confirmation');
  for (let index = 0; index < input.length; index += 2) {
    const key = input[index], value = input[index + 1];
    if (!['--student-id', '--confirm'].includes(key) || values.has(key)) throw new Error('Invalid confirmation');
    values.set(key, value);
  }
  const target = values.get('--student-id');
  if (!target || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(target) || /^(all|everyone)$/i.test(target) || values.get('--confirm') !== target) throw new Error('Invalid confirmation');
  return target;
}

export function deactivationConfiguration(env: NodeJS.ProcessEnv) {
  const config = productionRuntimeConfiguration(env);
  assertPreviewDeployDatabase(config.databaseUrl, env.PREVIEW_DATABASE_CONFIRMATION, env.PREVIEW_DATABASE_HOST);
  return config;
}

async function summary(prisma: PrismaClient, studentId: string) {
  const student = await prisma.runtimeStudent.findUnique({where:{id:studentId},select:{status:true}});
  if (!student) throw new Error('Target unavailable');
  return {
    status: student.status,
    activeIdentityLinks: await prisma.externalIdentityLink.count({where:{studentId,active:true}}),
    unrevokedSessions: await prisma.studentSession.count({where:{studentId,revokedAt:null}}),
    runtimeAttempts: await prisma.runtimeAttempt.count({where:{studentId}}),
    ledgerAttempts: await prisma.studentAttempt.count({where:{studentId}}),
    auditEvents: await prisma.runtimeAuditEvent.count({where:{attempt:{studentId}}}),
    snapshots: await prisma.runtimeSnapshot.count({where:{attempt:{studentId}}}),
  };
}

// The operator adapter only reads. All mutations belong to the existing service.
export async function deactivatePreviewStudent(prisma: PrismaClient, service: Pick<PreviewProvisioningService, 'deactivate'>, studentId: string) {
  const before = await summary(prisma, studentId);
  await service.deactivate(studentId);
  const after = await summary(prisma, studentId);
  const success = after.status === 'DEACTIVATED' && after.activeIdentityLinks === 0 && after.unrevokedSessions === 0 &&
    before.runtimeAttempts === after.runtimeAttempts && before.ledgerAttempts === after.ledgerAttempts &&
    before.auditEvents === after.auditEvents && before.snapshots === after.snapshots;
  return {studentId, before, after, success};
}
