import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface AuthenticatedStudentPrincipal {
  readonly subject: string;
  readonly studentId: string;
  readonly displayName: string;
}

export interface StudentSessionAuthenticator {
  authenticate(request: IncomingMessage): AuthenticatedStudentPrincipal | null;
}

export interface LocalDevelopmentProfile {
  readonly key: string;
  readonly principal: AuthenticatedStudentPrincipal;
}

export const studentSessionCookie = 'bbb_student_session';

export const localDevelopmentProfiles: readonly LocalDevelopmentProfile[] = Object.freeze([
  Object.freeze({ key: 'STUDENT_A', principal: Object.freeze({ subject: 'local-dev|student-a', studentId: 'student-a', displayName: 'Student A' }) }),
  Object.freeze({ key: 'STUDENT_B', principal: Object.freeze({ subject: 'local-dev|student-b', studentId: 'student-b', displayName: 'Student B' }) }),
]);

function cookieValue(request: IncomingMessage, name: string) {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return cookie.slice(separator + 1).trim();
  }
  return undefined;
}

export class InMemoryStudentSessionAuthenticator implements StudentSessionAuthenticator {
  private readonly sessions = new Map<string, { readonly principal: AuthenticatedStudentPrincipal; readonly expiresAt: number }>();

  authenticate(request: IncomingMessage) {
    const token = cookieValue(request, studentSessionCookie);
    const session = token ? this.sessions.get(token) : undefined;
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token!);
      return null;
    }
    return session.principal;
  }

  create(profileKey: string) {
    const profile = localDevelopmentProfiles.find(item => item.key === profileKey);
    if (!profile) return null;
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { principal: profile.principal, expiresAt: Date.now() + 28_800_000 });
    return Object.freeze({ principal: profile.principal, cookie: `${studentSessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
  }

  replace(request: IncomingMessage, profileKey: string) {
    this.destroy(request);
    return this.create(profileKey);
  }

  destroy(request: IncomingMessage) {
    const token = cookieValue(request, studentSessionCookie);
    if (token) this.sessions.delete(token);
  }

  clearCookie() {
    return `${studentSessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }
}
