import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createStudentWebServer } from '../apps/web/server.js';

const servers: ReturnType<typeof createStudentWebServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function runningServer(options: Parameters<typeof createStudentWebServer>[0] = {}) {
  const server = createStudentWebServer(options);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function login(origin: string, profile: 'STUDENT_A' | 'STUDENT_B', extra = '') {
  const response = await fetch(`${origin}/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `profile=${profile}${extra}`,
  });
  const cookie = response.headers.get('set-cookie')!;
  return { response, cookie: cookie.split(';')[0] };
}

const authenticated = (url: string, cookie: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...init.headers, cookie } });

describe('P-009A local authentication and student session foundation', () => {
  it('has no fixed local-student application authority and fails unauthenticated access safely', async () => {
    const source = await readFile(new URL('../apps/web/server.ts', import.meta.url), 'utf8');
    expect(source).not.toContain("studentId: 'local-student'");
    const origin = await runningServer();
    const page = await fetch(origin, { redirect: 'manual' });
    const api = await fetch(`${origin}/api/student`);
    const action = await fetch(`${origin}/action`, { method: 'POST', body: new URLSearchParams() });
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('Local development sign in');
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: 'Authentication required' });
    expect(action.status).toBe(401);
  });

  it('creates two opaque persistent server sessions with distinct authenticated principals', async () => {
    const origin = await runningServer();
    const first = await login(origin, 'STUDENT_A');
    const second = await login(origin, 'STUDENT_B');
    expect(first.response.status).toBe(303);
    expect(first.response.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800/);
    expect(first.cookie).not.toBe(second.cookie);

    expect((await authenticated(origin, first.cookie)).status).toBe(200);
    expect((await authenticated(origin, second.cookie)).status).toBe(200);
    const firstModel = await (await authenticated(`${origin}/api/student`, first.cookie)).json();
    const secondModel = await (await authenticated(`${origin}/api/student`, second.cookie)).json();
    expect(firstModel.shell.attemptId).toBe('student-a-suncoast-1');
    expect(secondModel.shell.attemptId).toBe('student-b-suncoast-1');
    expect(firstModel.shell.attemptId).not.toBe(secondModel.shell.attemptId);

    for (const screen of ['dashboard', 'documents', 'inbox', 'coach', 'meeting', 'results']) {
      const firstPage = await authenticated(`${origin}/?attempt=${firstModel.shell.attemptId}&screen=${screen}`, first.cookie);
      const secondPage = await authenticated(`${origin}/?attempt=${secondModel.shell.attemptId}&screen=${screen}`, second.cookie);
      expect(firstPage.status, `Student A ${screen}`).toBe(200);
      expect(secondPage.status, `Student B ${screen}`).toBe(200);
    }

    const refreshed = await authenticated(`${origin}/api/student?attempt=${firstModel.shell.attemptId}&screen=documents`, first.cookie);
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).shell.attemptId).toBe(firstModel.shell.attemptId);
  }, 60_000);

  it('fails closed and equivalently across all browser-addressable foreign attempt surfaces', async () => {
    const origin = await runningServer();
    const first = await login(origin, 'STUDENT_A');
    const second = await login(origin, 'STUDENT_B');
    await authenticated(origin, first.cookie);
    await authenticated(origin, second.cookie);
    const firstModel = await (await authenticated(`${origin}/api/student`, first.cookie)).json();
    await authenticated(`${origin}/api/student`, second.cookie);
    const nonexistent = 'student-a-suncoast-999';

    for (const screen of ['dashboard', 'bank', 'sales', 'documents', 'inbox', 'coach', 'meeting', 'results']) {
      const foreign = await authenticated(`${origin}/?attempt=${firstModel.shell.attemptId}&screen=${screen}&focus=guessed-resource`, second.cookie);
      const absent = await authenticated(`${origin}/?attempt=${nonexistent}&screen=${screen}&focus=guessed-resource`, second.cookie);
      expect(foreign.status, screen).toBe(404);
      expect(absent.status, screen).toBe(404);
      expect(await foreign.text()).toBe(await absent.text());
    }

    const foreignApi = await authenticated(`${origin}/api/student?attempt=${firstModel.shell.attemptId}&screen=results&studentId=student-a`, second.cookie);
    const absentApi = await authenticated(`${origin}/api/student?attempt=${nonexistent}&screen=results&studentId=student-a`, second.cookie);
    expect(foreignApi.status).toBe(404);
    expect(absentApi.status).toBe(404);
    expect(await foreignApi.text()).toBe(await absentApi.text());

    const actionBody = (attemptId: string) => new URLSearchParams({ attemptId, screen: 'bank', intent: 'review', targetId: 'guessed-entry', revision: '0', key: 'foreign-action' });
    const foreignAction = await authenticated(`${origin}/action`, second.cookie, { method: 'POST', body: actionBody(firstModel.shell.attemptId) });
    const absentAction = await authenticated(`${origin}/action`, second.cookie, { method: 'POST', body: actionBody(nonexistent) });
    expect(foreignAction.status).toBe(404);
    expect(absentAction.status).toBe(404);
    expect(await foreignAction.text()).toBe(await absentAction.text());
  }, 60_000);

  it('does not let browser-controlled identity values override the authenticated principal', async () => {
    const origin = await runningServer();
    const first = await login(origin, 'STUDENT_A');
    const second = await login(origin, 'STUDENT_B', '&studentId=student-a&subject=local-dev%7Cstudent-a');
    await authenticated(origin, first.cookie);
    await authenticated(origin, second.cookie);
    const firstModel = await (await authenticated(`${origin}/api/student`, first.cookie)).json();
    const spoofed = await authenticated(`${origin}/api/student?studentId=student-a&subject=local-dev%7Cstudent-a`, second.cookie);
    expect(spoofed.status).toBe(200);
    expect((await spoofed.json()).shell.attemptId).toBe('student-b-suncoast-1');
    expect((await authenticated(`${origin}/?attempt=${firstModel.shell.attemptId}&studentId=student-a`, second.cookie)).status).toBe(404);
    expect((await fetch(`${origin}/api/student`, { headers: { cookie: 'bbb_student_session=student-a' } })).status).toBe(401);
    const invalidProfile = await fetch(`${origin}/auth/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'profile=NOT_A_PROFILE&studentId=student-a' });
    expect(invalidProfile.status).toBe(404);
  });

  it('clears authenticated access on logout and disables the fictional selector in production mode', async () => {
    const origin = await runningServer();
    const session = await login(origin, 'STUDENT_A');
    await authenticated(origin, session.cookie);
    const replacement = await fetch(`${origin}/auth/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: session.cookie }, body: 'profile=STUDENT_B' });
    const replacementCookie = replacement.headers.get('set-cookie')!.split(';')[0];
    expect((await authenticated(`${origin}/api/student`, session.cookie)).status).toBe(401);
    await authenticated(origin, replacementCookie);
    expect((await (await authenticated(`${origin}/api/student`, replacementCookie)).json()).shell.attemptId).toBe('student-b-suncoast-1');
    const logout = await authenticated(`${origin}/auth/logout`, replacementCookie, { method: 'POST', redirect: 'manual' });
    expect(logout.status).toBe(303);
    expect(logout.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await authenticated(`${origin}/api/student`, replacementCookie)).status).toBe(401);

    const productionOrigin = await runningServer({ localAuthenticationEnabled: false });
    expect((await fetch(`${productionOrigin}/login`)).status).toBe(401);
    expect((await fetch(`${productionOrigin}/auth/login`, { method: 'POST', body: 'profile=STUDENT_A' })).status).toBe(401);
    expect(await (await fetch(productionOrigin)).text()).not.toContain('Student A');
  });
});
