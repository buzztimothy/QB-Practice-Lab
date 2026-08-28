import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { IncomingMessage } from 'node:http';

export interface AuthenticatedStudentPrincipal {
  readonly subject: string;
  readonly studentId: string;
  readonly displayName: string;
}

export interface StudentSessionAuthenticator {
  authenticate(request: IncomingMessage): AuthenticatedStudentPrincipal | null | Promise<AuthenticatedStudentPrincipal | null>;
}

export interface LocalStudentSessionAuthenticator extends StudentSessionAuthenticator {
  replace(request:IncomingMessage,profileKey:string,secure?:boolean):Promise<{readonly principal:AuthenticatedStudentPrincipal;readonly cookie:string}|null>;
  destroy(request:IncomingMessage):Promise<void>;
  clearCookie():string;
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

export interface InMemoryStudentSessionOptions {
  readonly now?: () => number;
  readonly token?: () => string;
}

export function cookieValue(request: IncomingMessage, name: string) {
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
  private readonly now: () => number;
  private readonly token: () => string;

  constructor(options: InMemoryStudentSessionOptions = {}) {
    this.now = options.now ?? Date.now;
    this.token = options.token ?? (() => randomBytes(32).toString('base64url'));
  }

  async authenticate(request: IncomingMessage) {
    const token = cookieValue(request, studentSessionCookie);
    const session = token ? this.sessions.get(token) : undefined;
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(token!);
      return null;
    }
    return session.principal;
  }

  async create(profileKey: string, secure = false) {
    const profile = localDevelopmentProfiles.find(item => item.key === profileKey);
    if (!profile) return null;
    let token = this.token();
    while (this.sessions.has(token)) token = this.token();
    this.sessions.set(token, { principal: profile.principal, expiresAt: this.now() + 28_800_000 });
    return Object.freeze({ principal: profile.principal, cookie: `${studentSessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}` });
  }

  async replace(request: IncomingMessage, profileKey: string, secure = false) {
    await this.destroy(request);
    return this.create(profileKey, secure);
  }

  async destroy(request: IncomingMessage) {
    const token = cookieValue(request, studentSessionCookie);
    if (token) this.sessions.delete(token);
  }

  clearCookie() {
    return `${studentSessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }
}

export const hashToken=(token:string)=>createHash('sha256').update(token).digest('hex');

export class PrismaStudentSessionAuthenticator implements LocalStudentSessionAuthenticator {
  private readonly now:()=>number;private readonly token:()=>string;
  constructor(private readonly prisma:PrismaClient,options:InMemoryStudentSessionOptions={}){this.now=options.now??Date.now;this.token=options.token??(()=>randomBytes(32).toString('base64url'));}
  async authenticate(request:IncomingMessage){const token=cookieValue(request,studentSessionCookie);if(!token)return null;const session=await this.prisma.studentSession.findUnique({where:{tokenHash:hashToken(token)},include:{student:true}});if(!session||session.revokedAt||session.expiresAt.getTime()<=this.now()||session.student.status!=='ACTIVE')return null;return Object.freeze({subject:session.subject,studentId:session.studentId,displayName:session.displayName});}
  async create(profileKey:string,secure=false){const profile=localDevelopmentProfiles.find(item=>item.key===profileKey);if(!profile)return null;const token=this.token(),expiresAt=new Date(this.now()+28_800_000);await this.prisma.$transaction(async tx=>{await tx.runtimeStudent.upsert({where:{id:profile.principal.studentId},create:{id:profile.principal.studentId,displayName:profile.principal.displayName},update:{displayName:profile.principal.displayName}});await tx.studentSession.create({data:{tokenHash:hashToken(token),studentId:profile.principal.studentId,subject:profile.principal.subject,displayName:profile.principal.displayName,expiresAt}});});return Object.freeze({principal:profile.principal,cookie:`${studentSessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure?'; Secure':''}`});}
  async replace(request:IncomingMessage,profileKey:string,secure=false){await this.destroy(request);return this.create(profileKey,secure);}
  async destroy(request:IncomingMessage){const token=cookieValue(request,studentSessionCookie);if(token)await this.prisma.studentSession.updateMany({where:{tokenHash:hashToken(token),revokedAt:null},data:{revokedAt:new Date(this.now())}});}
  clearCookie(){return `${studentSessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;}
  async issue(request:IncomingMessage,principal:AuthenticatedStudentPrincipal,secure=true,ttlSeconds=28_800){await this.destroy(request);const token=this.token(),expiresAt=new Date(this.now()+ttlSeconds*1000);await this.prisma.studentSession.create({data:{tokenHash:hashToken(token),studentId:principal.studentId,subject:principal.subject,displayName:principal.displayName,expiresAt}});return Object.freeze({principal,cookie:`${studentSessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttlSeconds}${secure?'; Secure':''}`});}
  async revokeStudent(studentId:string){await this.prisma.studentSession.updateMany({where:{studentId,revokedAt:null},data:{revokedAt:new Date(this.now())}});}
}
