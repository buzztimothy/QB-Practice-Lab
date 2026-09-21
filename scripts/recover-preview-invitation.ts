import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import { InvitationRecoveryService } from '../apps/web/invitation-recovery.js';
import { ClerkInvitationRecoveryProvider } from '../apps/web/invitation-recovery-provider.js';
import { clerkAccountPortalUrl } from '../apps/web/clerk-account-portal.js';
import { recoveryConfiguration, recoveryTarget } from './preview-invitation-recovery.js';

let prisma: PrismaClient | undefined;
try {
  const target = recoveryTarget(process.argv.slice(2));
  const config = recoveryConfiguration(process.env);
  const redirect = clerkAccountPortalUrl(process.env.CLERK_SIGN_IN_URL, config.appOrigin, 'sign-up');
  prisma = new PrismaClient({ datasources:{ db:{ url:config.databaseUrl } } });
  const provider = new ClerkInvitationRecoveryProvider(createClerkClient({ secretKey:config.clerk.secretKey }));
  const result = await new InvitationRecoveryService(prisma, provider, redirect).recover(target);
  console.log(JSON.stringify(result));
  if (!result.success) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ success:false, status:'BLOCKED', failure:'OPERATOR_VALIDATION_OR_RUNTIME_FAILED' }));
  process.exitCode = 1;
} finally {
  try { await prisma?.$disconnect(); } catch { console.error(JSON.stringify({ success:false, failure:'DISCONNECT_FAILED' })); process.exitCode = 1; }
}
