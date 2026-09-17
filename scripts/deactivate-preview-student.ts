import { createClerkClient } from '@clerk/backend';
import { PrismaClient } from '@prisma/client';
import { PreviewProvisioningService } from '../apps/web/preview-provisioning.js';
import { deactivationConfiguration, deactivationTarget, deactivatePreviewStudent } from './preview-deactivation.js';

let prisma: PrismaClient | undefined;
let studentId: string | undefined;
try {
  studentId = deactivationTarget(process.argv.slice(2));
  const config = deactivationConfiguration(process.env);
  prisma = new PrismaClient({datasources:{db:{url:config.databaseUrl}}});
  const service = new PreviewProvisioningService(prisma, createClerkClient({secretKey:config.clerk.secretKey}), `${config.appOrigin}/auth/callback`);
  const result = await deactivatePreviewStudent(prisma, service, studentId);
  console.log(JSON.stringify(result));
  if (!result.success) process.exitCode = 1;
} catch {
  // Provider/Prisma errors can contain connection details or identity data.
  console.error(JSON.stringify({studentId,success:false}));
  process.exitCode = 1;
} finally {
  try { await prisma?.$disconnect(); } catch { process.exitCode = 1; }
}
