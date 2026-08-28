import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import type { PrismaClient } from '@prisma/client';
import { cookieValue, hashToken, studentSessionCookie, type AuthenticatedStudentPrincipal } from './authentication.js';
import type { ProductionRuntimeConfiguration } from './runtime-configuration.js';

export interface VerifiedExternalIdentity {
  readonly provider: 'clerk';
  readonly subject: string;
  readonly email: string;
}

export interface ExternalIdentityHandshake {
  readonly kind: 'handshake';
  readonly location: string;
  readonly headers: Headers;
}

export type ExternalIdentityVerification=VerifiedExternalIdentity|ExternalIdentityHandshake;

export interface ExternalIdentityVerifier {
  verify(request: Request): Promise<ExternalIdentityVerification | null>;
  revoke(request: Request): Promise<void>;
}

export interface VerifiedIdentityWebhook {
  readonly id: string;
  readonly type: 'user.updated' | 'user.deleted';
  readonly subject: string;
  readonly email?: string;
  readonly disabled: boolean;
}

export interface IdentityWebhookVerifier {
  verify(request: Request): Promise<VerifiedIdentityWebhook | null>;
}

export interface ProductionIdentityService {
  exchange(request:IncomingMessage,identity:VerifiedExternalIdentity):Promise<{readonly principal:AuthenticatedStudentPrincipal;readonly cookie:string}|null>;
  processWebhook(event:VerifiedIdentityWebhook):Promise<void>;
}

const normalizedEmail=(value:string)=>value.trim().toLowerCase();

export class ClerkExternalIdentityVerifier implements ExternalIdentityVerifier {
  constructor(private readonly clerk:ClerkClient,private readonly config:ProductionRuntimeConfiguration['clerk']){}
  private authenticate(request:Request){return this.clerk.authenticateRequest(request,{acceptsToken:'session_token',audience:this.config.audience,authorizedParties:[this.config.authorizedParty],jwtKey:this.config.jwtKey,secretKey:this.config.secretKey,publishableKey:this.config.publishableKey});}
  async verify(request:Request){
    const state=await this.authenticate(request);
    const location=state.headers.get('location');
    if(location)return Object.freeze({kind:'handshake' as const,location,headers:state.headers});
    if(!state.isAuthenticated)return null;
    const auth=state.toAuth();
    const claims=auth.sessionClaims;
    const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    if(!auth.userId||claims.iss!==this.config.issuer||!audience.includes(this.config.audience))return null;
    const user=await this.clerk.users.getUser(auth.userId);
    if(user.banned||user.locked||!user.primaryEmailAddressId)return null;
    const email=user.emailAddresses.find(item=>item.id===user.primaryEmailAddressId);
    if(!email||email.verification?.status!=='verified')return null;
    return Object.freeze({provider:'clerk' as const,subject:user.id,email:normalizedEmail(email.emailAddress)});
  }
  async revoke(request:Request){const state=await this.authenticate(request);if(!state.isAuthenticated)return;const sessionId=state.toAuth().sessionId;if(sessionId)await this.clerk.sessions.revokeSession(sessionId);}
}

export class ClerkIdentityWebhookVerifier implements IdentityWebhookVerifier {
  constructor(private readonly signingSecret:string){}
  async verify(request:Request){
    const eventId=request.headers.get('svix-id');
    if(!eventId)return null;
    const event=await verifyWebhook(request,{signingSecret:this.signingSecret});
    if(event.type!=='user.updated'&&event.type!=='user.deleted')return null;
    if(event.type==='user.deleted')return event.data.id?Object.freeze({id:eventId,type:event.type,subject:event.data.id,disabled:true}):null;
    const primary=event.data.email_addresses.find(item=>item.id===event.data.primary_email_address_id);
    const email=primary?.verification?.status==='verified'?normalizedEmail(primary.email_address):undefined;
    return Object.freeze({id:eventId,type:event.type,subject:event.data.id,email,disabled:event.data.banned||event.data.locked});
  }
}

export class PreviewIdentityService implements ProductionIdentityService {
  constructor(private readonly prisma:PrismaClient,private readonly ttlSeconds:number,private readonly now:()=>Date=()=>new Date()){}

  async exchange(request:IncomingMessage,identity:VerifiedExternalIdentity){
    const token=randomBytes(32).toString('base64url');
    const current=cookieValue(request,studentSessionCookie);
    const principal=await this.prisma.$transaction(async tx=>{
      if(current)await tx.studentSession.updateMany({where:{tokenHash:hashToken(current),revokedAt:null},data:{revokedAt:this.now()}});
      let link=await tx.externalIdentityLink.findUnique({where:{provider_subject:{provider:identity.provider,subject:identity.subject}},include:{student:true}});
      if(!link){
        const invitation=await tx.previewInvitation.findUnique({where:{provider_email:{provider:identity.provider,email:identity.email}},include:{student:true}});
        if(!invitation||invitation.status!=='SENT'||invitation.student.status==='DEACTIVATED')return null;
        link=await tx.externalIdentityLink.create({data:{provider:identity.provider,subject:identity.subject,email:identity.email,studentId:invitation.studentId},include:{student:true}});
        await tx.previewInvitation.update({where:{id:invitation.id},data:{status:'CONSUMED',consumedSubject:identity.subject,consumedAt:this.now()}});
        await tx.runtimeStudent.update({where:{id:invitation.studentId},data:{status:'ACTIVE',email:identity.email}});
      }
      if(!link.active||link.student.status==='DEACTIVATED')return null;
      if(link.email!==identity.email)await tx.externalIdentityLink.update({where:{id:link.id},data:{email:identity.email}});
      await tx.runtimeStudent.update({where:{id:link.studentId},data:{email:identity.email}});
      const result=Object.freeze({subject:`clerk|${identity.subject}`,studentId:link.studentId,displayName:link.student.displayName}) satisfies AuthenticatedStudentPrincipal;
      await tx.studentSession.updateMany({where:{studentId:result.studentId,revokedAt:null},data:{revokedAt:this.now()}});
      await tx.studentSession.create({data:{tokenHash:hashToken(token),studentId:result.studentId,subject:result.subject,displayName:result.displayName,expiresAt:new Date(this.now().getTime()+this.ttlSeconds*1000)}});
      return result;
    });
    if(!principal)return null;
    return Object.freeze({principal,cookie:`${studentSessionCookie}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${this.ttlSeconds}`});
  }

  async processWebhook(event:VerifiedIdentityWebhook){
    await this.prisma.$transaction(async tx=>{
      const duplicate=await tx.providerWebhookEvent.findUnique({where:{provider_providerEventId:{provider:'clerk',providerEventId:event.id}}});
      if(duplicate)return;
      const link=await tx.externalIdentityLink.findUnique({where:{provider_subject:{provider:'clerk',subject:event.subject}}});
      await tx.providerWebhookEvent.create({data:{provider:'clerk',providerEventId:event.id,eventType:event.type}});
      if(!link)return;
      if(event.disabled){
        await tx.externalIdentityLink.update({where:{id:link.id},data:{active:false}});
        await tx.runtimeStudent.update({where:{id:link.studentId},data:{status:'DEACTIVATED'}});
        await tx.studentSession.updateMany({where:{studentId:link.studentId,revokedAt:null},data:{revokedAt:this.now()}});
      }else if(event.email){
        await tx.externalIdentityLink.update({where:{id:link.id},data:{email:event.email}});
        await tx.runtimeStudent.update({where:{id:link.studentId},data:{email:event.email}});
      }
    });
  }
}

export function createClerkProductionAuthentication(config:ProductionRuntimeConfiguration){
  const clerk=createClerkClient({secretKey:config.clerk.secretKey,publishableKey:config.clerk.publishableKey,jwtKey:config.clerk.jwtKey,audience:config.clerk.audience});
  return Object.freeze({identityVerifier:new ClerkExternalIdentityVerifier(clerk,config.clerk),webhookVerifier:new ClerkIdentityWebhookVerifier(config.clerk.webhookSigningSecret)});
}
