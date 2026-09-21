import type { Prisma } from '@prisma/client';

export async function lockInvitationStudent(tx: Prisma.TransactionClient, studentId: string) {
  const key = `invitation-student:${studentId}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
