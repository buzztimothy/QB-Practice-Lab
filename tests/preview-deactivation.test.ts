import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { deactivationConfiguration, deactivationTarget, deactivatePreviewStudent } from '../scripts/preview-deactivation.js';

describe('preview emergency deactivation guards', () => {
  it('requires one exact explicit target and matching confirmation', () => {
    expect(deactivationTarget(['--student-id','d003-student-a','--confirm','d003-student-a'])).toBe('d003-student-a');
    expect(deactivationTarget(['--','--confirm','a','--student-id','a'])).toBe('a');
    for (const args of [[], ['--student-id','a'], ['--student-id','a','--confirm','b'],
      ['--student-id','a','--student-id','a'], ['--student-id','a','--confirm','a','--all'],
      ['--all','a','--confirm','a'], ...['*','all','ALL','a,b','a b',' a','a\n','--all'].map(id=>['--student-id',id,'--confirm',id])]) {
      expect(()=>deactivationTarget(args)).toThrow();
    }
  });

  it('requires production Preview configuration and the established direct deploy database guard', () => {
    const env = {NODE_ENV:'production',DEPLOYMENT_TARGET:'preview',DURABLE_RUNTIME_ENABLED:'true',LOCAL_AUTH_ENABLED:'false',
      APP_ORIGIN:'https://preview.clientpracticelabs.com',CANONICAL_LAB_VERSION:'SUNCOAST-L1-2026.08-D000R.1',SESSION_TTL_SECONDS:'28800',
      DATABASE_URL:'postgresql://bbb_preview_deploy_lp:fixture@preview.example.test/bbb_practice_preview?sslmode=require',
      PREVIEW_DATABASE_CONFIRMATION:'bbb_practice_preview',PREVIEW_DATABASE_HOST:'preview.example.test',
      CLERK_SECRET_KEY:'fixture',CLERK_PUBLISHABLE_KEY:'fixture',CLERK_JWT_KEY:'fixture',CLERK_ISSUER:'https://clerk.example.test',
      CLERK_AUDIENCE:'preview',CLERK_AUTHORIZED_PARTY:'https://preview.clientpracticelabs.com',CLERK_SIGN_IN_URL:'https://clerk.example.test/sign-in',CLERK_WEBHOOK_SIGNING_SECRET:'fixture'};
    expect(deactivationConfiguration(env).production).toBe(true);
    for (const key of Object.keys(env)) {
      if (key === 'LOCAL_AUTH_ENABLED') continue;
      expect(()=>deactivationConfiguration({...env,[key]:''})).toThrow();
    }
    for (const change of [{LOCAL_AUTH_ENABLED:'true'},{NODE_ENV:'test'},{DEPLOYMENT_TARGET:'production'},
      {PREVIEW_DATABASE_HOST:'other.example.test'},{DATABASE_URL:env.DATABASE_URL.replace('bbb_practice_preview','production')},
      {DATABASE_URL:env.DATABASE_URL.replace('bbb_preview_deploy_lp','bbb_preview_runtime_lp')},
      {DATABASE_URL:env.DATABASE_URL.replace('preview.example.test','preview-pooler.example.test'),PREVIEW_DATABASE_HOST:'preview-pooler.example.test'}]) {
      expect(()=>deactivationConfiguration({...env,...change})).toThrow();
    }
  });

  it('never invokes deactivation when the target does not exist', async () => {
    const service={deactivate:vi.fn()};
    const prisma={runtimeStudent:{findUnique:vi.fn().mockResolvedValue(null)}} as unknown as PrismaClient;
    await expect(deactivatePreviewStudent(prisma,service,'missing')).rejects.toThrow('Target unavailable');
    expect(service.deactivate).not.toHaveBeenCalled();
  });

  it('invokes only the existing service for the exact target and reports failed postconditions', async () => {
    const count=vi.fn().mockResolvedValue(1);
    const prisma={runtimeStudent:{findUnique:vi.fn().mockResolvedValue({status:'ACTIVE'})},externalIdentityLink:{count},studentSession:{count},runtimeAttempt:{count},studentAttempt:{count},runtimeAuditEvent:{count},runtimeSnapshot:{count}} as unknown as PrismaClient;
    const service={deactivate:vi.fn().mockResolvedValue(undefined)};
    expect((await deactivatePreviewStudent(prisma,service,'target')).success).toBe(false);
    expect(service.deactivate).toHaveBeenCalledExactlyOnceWith('target');
  });
});
