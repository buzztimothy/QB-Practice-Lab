import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ invite:vi.fn(), disconnect:vi.fn(), redirect:'', constructed:0 }));
vi.mock('@prisma/client', () => ({ PrismaClient:class { $disconnect = calls.disconnect; } }));
vi.mock('@clerk/backend', () => ({ createClerkClient:() => ({}) }));
vi.mock('../apps/web/preview-provisioning.js', () => ({ PreviewProvisioningService:class {
  constructor(_prisma:unknown, _clerk:unknown, redirect:string) { calls.redirect=redirect; calls.constructed++; }
  invite = calls.invite;
} }));

const argv = process.argv, exitCode = process.exitCode;
beforeEach(() => {
  vi.resetModules(); calls.invite.mockReset(); calls.disconnect.mockReset(); calls.constructed=0;
  vi.stubEnv('CLERK_SIGN_IN_URL', 'https://accounts.example/sign-in');
  vi.stubEnv('CLERK_SECRET_KEY', 'fixture-only');
  process.argv=['node','operator','--','--origin','https://preview.clientpracticelabs.com','--student-id','fixture-student','--display-name','Fixture','--email','fixture@example.test'];
});
afterEach(() => { process.argv=argv; process.exitCode=exitCode; vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('invitation operator handoff', () => {
  it('passes the hosted signup target to provisioning and prints no provider URL', async () => {
    const log=vi.spyOn(console,'log').mockImplementation(() => {});
    calls.invite.mockResolvedValue({ id:'fixture-id', status:'SENT', url:'private-provider-url' });
    await import('../scripts/provision-preview-student.js');
    const target=new URL(calls.redirect);
    expect(target.pathname).toBe('/sign-up');
    expect(target.searchParams.get('redirect_url')).toBe('https://preview.clientpracticelabs.com/auth/callback');
    expect(calls.invite).toHaveBeenCalledExactlyOnceWith({ studentId:'fixture-student', displayName:'Fixture', email:'fixture@example.test' });
    expect(log).toHaveBeenCalledExactlyOnceWith('Preview invitation ready: fixture-id (SENT)');
    expect(calls.disconnect).toHaveBeenCalledOnce();
  });

  it('suppresses sensitive provider failures and does not retry', async () => {
    const error=vi.spyOn(console,'error').mockImplementation(() => {});
    calls.invite.mockRejectedValue(new Error('private-ticket private-cookie private-credential'));
    await import('../scripts/provision-preview-student.js');
    expect(process.exitCode).toBe(1);
    expect(calls.invite).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledExactlyOnceWith('Preview invitation failed; inspect bounded state before retrying.');
    expect(calls.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects missing portal configuration before calling provisioning', async () => {
    vi.stubEnv('CLERK_SIGN_IN_URL', '');
    vi.spyOn(console,'error').mockImplementation(() => {});
    await import('../scripts/provision-preview-student.js');
    expect(process.exitCode).toBe(1); expect(calls.constructed).toBe(0);
    expect(calls.invite).not.toHaveBeenCalled();
  });
});
