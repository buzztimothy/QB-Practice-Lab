import type { AddressInfo } from 'node:net';
import type { ClerkClient } from '@clerk/backend';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootstrapCanonicalLab, canonicalLabVersion, PrismaStudentAttemptRepository } from '../apps/student/persistence.js';
import { StudentApplication } from '../apps/student/application.js';
import { PrismaStudentSessionAuthenticator } from '../apps/web/authentication.js';
import { clerkAccountPortalUrl, previewApplicationOrigin } from '../apps/web/clerk-account-portal.js';
import { PreviewProvisioningService } from '../apps/web/preview-provisioning.js';
import { ClerkExternalIdentityVerifier, PreviewIdentityService } from '../apps/web/production-authentication.js';
import { productionRuntimeConfiguration } from '../apps/web/runtime-configuration.js';
import { createStudentWebServer } from '../apps/web/server.js';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';

const url = process.env.DATABASE_URL;
if (url) assertDisposableTestDatabase(url, process.env.DATABASE_LIFECYCLE_MARKER);
const prisma = new PrismaClient(), describeDb = url ? describe : describe.skip;

describeDb('D-003B hosted invitation handoff (simulated provider, real application persistence)', () => {
  beforeAll(async () => { await prisma.$connect(); await bootstrapCanonicalLab(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('requires completed verified signup before mapping/exchange and leaves the control student unchanged', async () => {
    const suffix = crypto.randomUUID(), studentId = `invite-a-${suffix}`, controlId = `invite-b-${suffix}`, email = `invite-${suffix}@example.test`;
    const config = productionRuntimeConfiguration({ NODE_ENV:'production', DEPLOYMENT_TARGET:'preview', DURABLE_RUNTIME_ENABLED:'true', DATABASE_URL:'postgresql://fixture@localhost/qb_invitation_test?sslmode=require', APP_ORIGIN:previewApplicationOrigin, SESSION_TTL_SECONDS:'28800', CANONICAL_LAB_VERSION:canonicalLabVersion, CLERK_SECRET_KEY:'fixture', CLERK_PUBLISHABLE_KEY:'fixture', CLERK_JWT_KEY:'fixture', CLERK_ISSUER:'https://clerk.example', CLERK_AUDIENCE:'preview', CLERK_AUTHORIZED_PARTY:previewApplicationOrigin, CLERK_SIGN_IN_URL:'https://accounts.example/sign-in', CLERK_WEBHOOK_SIGNING_SECRET:'fixture' });
    let authenticated = false, verified = false, subject = `user_${suffix}`, providerEmail = email;
    const createInvitation = vi.fn(async () => ({ id:`inv_${suffix}` }));
    const clerk = {
      invitations: { createInvitation },
      authenticateRequest: async () => ({ headers:new Headers(), isAuthenticated:authenticated, toAuth:() => ({ userId:subject, sessionClaims:{ iss:config.clerk.issuer, aud:[config.clerk.audience] } }) }),
      users: { getUser:async () => ({ id:subject, banned:false, locked:false, primaryEmailAddressId:'primary', emailAddresses:[{ id:'primary', emailAddress:providerEmail, verification:{ status:verified ? 'verified' : 'unverified' } }] }) },
    } as unknown as ClerkClient;
    await prisma.runtimeStudent.create({ data:{ id:controlId, displayName:'Control', status:'INVITED' } });
    const controlBefore = await prisma.runtimeStudent.findUniqueOrThrow({ where:{ id:controlId } });
    const redirect = clerkAccountPortalUrl('https://accounts.example/sign-in', previewApplicationOrigin, 'sign-up');
    const provision = new PreviewProvisioningService(prisma, clerk, redirect);
    await provision.invite({ studentId, displayName:'Isolated Student', email });
    expect(createInvitation).toHaveBeenCalledExactlyOnceWith({ emailAddress:email, notify:true, ignoreExisting:false, redirectUrl:redirect });
    expect(new URL(redirect).pathname).toBe('/sign-up');
    expect(new URL(redirect).searchParams.get('redirect_url')).toBe(`${previewApplicationOrigin}/auth/callback`);
    const server = createStudentWebServer({ application:new StudentApplication(new PrismaStudentAttemptRepository(prisma)), authenticator:new PrismaStudentSessionAuthenticator(prisma), productionMode:true, allowedOrigin:previewApplicationOrigin, productionIdentity:{ signInUrl:config.clerk.signInUrl, verifier:new ClerkExternalIdentityVerifier(clerk, config.clerk), webhookVerifier:{ verify:async () => null }, service:new PreviewIdentityService(prisma, 28800) } });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const exchange = (allowed = previewApplicationOrigin) => fetch(`${origin}/auth/exchange`, { method:'POST', redirect:'manual', headers:{ origin:allowed } });
    const noSession = async () => {
      expect(await prisma.studentSession.count({ where:{ studentId } })).toBe(0);
      expect(await prisma.externalIdentityLink.count({ where:{ studentId } })).toBe(0);
    };
    try {
      const login = await fetch(`${origin}/login`, { redirect:'manual' });
      expect(login.status).toBe(303); expect(login.headers.get('location')).toBe(config.clerk.signInUrl);
      // Clerk owns ticket validity. Model its refusal to authenticate for each
      // unsuccessful signup outcome; no ticket is interpreted by our callback.
      for (const outcome of ['invalid', 'expired', 'revoked']) {
        const response = await fetch(`${origin}/auth/callback?__clerk_ticket=fixture-${outcome}`, { redirect:'manual' });
        expect(response.status).toBe(401);
        expect(await response.text()).not.toContain(`fixture-${outcome}`);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect((await exchange()).status).toBe(401); await noSession();
      }
      authenticated = true; // Simulated hosted signup completes, then verification is required.
      expect((await exchange()).status).toBe(401); await noSession();
      verified = true;
      providerEmail = `wrong-${email}`; // No matching preauthorization, even with verified Clerk identity.
      expect((await exchange()).status).toBe(401); await noSession();
      providerEmail = email;
      await prisma.previewInvitation.update({ where:{ provider_email:{ provider:'clerk', email } }, data:{ status:'REVOKED' } });
      expect((await exchange()).status).toBe(401); await noSession();
      await prisma.previewInvitation.update({ where:{ provider_email:{ provider:'clerk', email } }, data:{ status:'SENT' } });
      expect((await exchange('https://attacker.example')).status).toBe(403); await noSession();
      const callback = await fetch(`${origin}/auth/callback`, { redirect:'manual' });
      expect(callback.status).toBe(200); expect(await callback.text()).toContain('action="/auth/exchange"');
      await noSession(); // Callback alone does not mint an application session.
      const result = await exchange();
      expect(result.status).toBe(303); expect(result.headers.get('location')).toBe('/');
      expect(result.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Strict/);
      expect(await result.text()).toBe('');
      expect(await prisma.previewInvitation.findUnique({ where:{ provider_email:{ provider:'clerk', email } } })).toMatchObject({ status:'CONSUMED', consumedSubject:subject });
      expect(await prisma.runtimeStudent.findUnique({ where:{ id:studentId } })).toMatchObject({ status:'ACTIVE' });
      expect(await prisma.studentSession.count({ where:{ studentId, revokedAt:null } })).toBe(1);
      const link = await prisma.externalIdentityLink.findFirstOrThrow({ where:{ studentId } });
      subject = `impostor_${suffix}`;
      expect((await exchange()).status).toBe(401);
      expect(await prisma.externalIdentityLink.findFirst({ where:{ studentId } })).toEqual(link);
      expect(await prisma.runtimeStudent.findUnique({ where:{ id:controlId } })).toEqual(controlBefore);
      expect(await Promise.all([
        prisma.externalIdentityLink.count({ where:{ studentId:controlId } }),
        prisma.studentSession.count({ where:{ studentId:controlId } }),
        prisma.runtimeAttempt.count({ where:{ studentId:controlId } }),
        prisma.studentAttempt.count({ where:{ studentId:controlId } }),
      ])).toEqual([0, 0, 0, 0]);
      expect(await prisma.runtimeAttempt.count({ where:{ studentId } })).toBe(0);
      const workspace = await fetch(origin, { redirect:'manual', headers:{ cookie:result.headers.get('set-cookie')!.split(';')[0] } });
      expect(workspace.status).toBe(200);
      const attempt = await prisma.runtimeAttempt.findFirstOrThrow({ where:{ studentId } });
      expect(await prisma.runtimeAttempt.count({ where:{ studentId } })).toBe(1);
      expect(await prisma.studentAttempt.findUnique({ where:{ id:attempt.ledgerAttemptId } })).toMatchObject({ studentId });
      expect(await prisma.runtimeAttempt.count({ where:{ studentId:controlId } })).toBe(0);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
