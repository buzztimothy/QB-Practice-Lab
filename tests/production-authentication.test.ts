import { createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createStudentWebServer } from '../apps/web/server.js';
import type { ClerkClient } from '@clerk/backend';
import { ClerkExternalIdentityVerifier, ClerkIdentityWebhookVerifier, type VerifiedExternalIdentity } from '../apps/web/production-authentication.js';
import { productionRuntimeConfiguration } from '../apps/web/runtime-configuration.js';
import { canonicalLabVersion } from '../apps/student/persistence.js';
import { assertDisposableTestDatabase, assertPreviewDeployDatabase } from '../scripts/database-target-guard.js';

const servers:ReturnType<typeof createStudentWebServer>[]=[];
afterEach(async()=>Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve())))));

const validEnvironment=():NodeJS.ProcessEnv=>({NODE_ENV:'production',DURABLE_RUNTIME_ENABLED:'true',LOCAL_AUTH_ENABLED:'false',DATABASE_URL:'postgresql://runtime:secret@db.example/bbb_practice_preview?sslmode=require',APP_ORIGIN:'https://preview.clientpracticelabs.com',SESSION_TTL_SECONDS:'28800',CANONICAL_LAB_VERSION:canonicalLabVersion,CLERK_SECRET_KEY:'sk_test_secret',CLERK_PUBLISHABLE_KEY:'pk_test_key',CLERK_JWT_KEY:'-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',CLERK_ISSUER:'https://clerk.example',CLERK_AUDIENCE:'bbb-preview',CLERK_AUTHORIZED_PARTY:'https://preview.clientpracticelabs.com',CLERK_SIGN_IN_URL:'https://accounts.example/sign-in',CLERK_WEBHOOK_SIGNING_SECRET:'whsec_test'});

describe('D-002 production authentication boundary',()=>{
  it('fails production startup configuration closed',()=>{
    expect(productionRuntimeConfiguration(validEnvironment()).appOrigin).toBe('https://preview.clientpracticelabs.com');
    for(const key of ['DATABASE_URL','APP_ORIGIN','CLERK_SECRET_KEY','CLERK_JWT_KEY','CLERK_WEBHOOK_SIGNING_SECRET','CANONICAL_LAB_VERSION']){const env=validEnvironment();delete env[key];expect(()=>productionRuntimeConfiguration(env),key).toThrow();}
    expect(()=>productionRuntimeConfiguration({...validEnvironment(),LOCAL_AUTH_ENABLED:'1'})).toThrow(/local authentication/i);
    expect(()=>productionRuntimeConfiguration({...validEnvironment(),CLERK_AUTHORIZED_PARTY:'https://attacker.example'})).toThrow(/authorized party/i);
    expect(()=>productionRuntimeConfiguration({...validEnvironment(),SESSION_TTL_SECONDS:'0'})).toThrow(/TTL/i);
    expect(()=>productionRuntimeConfiguration({...validEnvironment(),DATABASE_URL:'postgresql://runtime:secret@db.example/bbb_practice_preview'})).toThrow(/TLS/i);
  });

  it('keeps destructive test and Preview deployment database targets mutually exclusive',()=>{
    expect(()=>assertDisposableTestDatabase('postgresql://postgres:secret@localhost/qb_d002_validation','disposable-test')).not.toThrow();
    expect(()=>assertDisposableTestDatabase('postgresql://runtime:secret@db.example/bbb_practice_preview','disposable-test')).toThrow();
    expect(()=>assertPreviewDeployDatabase('postgresql://deploy:secret@db.example/bbb_practice_preview','bbb_practice_preview')).not.toThrow();
    expect(()=>assertPreviewDeployDatabase('postgresql://postgres:secret@localhost/qb_d002_validation','bbb_practice_preview')).toThrow();
  });

  it('accepts only an exact-origin identity-free exchange and issues the BBB cookie',async()=>{
    const identity:VerifiedExternalIdentity={provider:'clerk',subject:'user_external_a',email:'a@example.test'};
    let exchanges=0;
    const server=createStudentWebServer({productionMode:true,allowedOrigin:'http://127.0.0.1',productionIdentity:{signInUrl:'https://accounts.example/sign-in',verifier:{verify:async()=>identity,revoke:async()=>{}},webhookVerifier:{verify:async()=>null},service:{exchange:async()=>{exchanges++;return{principal:{subject:'clerk|user_external_a',studentId:'student-a',displayName:'Student A'},cookie:'bbb_student_session=opaque; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800'};},processWebhook:async()=>{}}}});
    servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as AddressInfo,origin=`http://127.0.0.1:${address.port}`;
    expect((await fetch(`${origin}/auth/exchange`,{method:'POST',redirect:'manual'})).status).toBe(403);
    expect((await fetch(`${origin}/auth/exchange`,{method:'POST',redirect:'manual',headers:{origin:'http://attacker.example'}})).status).toBe(403);
    const result=await fetch(`${origin}/auth/exchange?studentId=student-b`,{method:'POST',redirect:'manual',headers:{origin:'http://127.0.0.1'}});
    expect(result.status).toBe(303);expect(result.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Strict');expect(exchanges).toBe(1);
  });

  it('propagates the supported Clerk handshake redirect before exposing the exchange action',async()=>{
    const headers=new Headers({location:'https://clerk.example/v1/client/handshake?redirect_url=https%3A%2F%2Flab.example%2Fauth%2Fcallback','x-clerk-auth-reason':'session-token-expired'});
    const server=createStudentWebServer({productionMode:true,allowedOrigin:'https://lab.example',productionIdentity:{signInUrl:'https://accounts.example/sign-in',verifier:{verify:async()=>({kind:'handshake',location:headers.get('location')!,headers}),revoke:async()=>{}},webhookVerifier:{verify:async()=>null},service:{exchange:async()=>null,processWebhook:async()=>{}}}});
    servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as AddressInfo,origin=`http://127.0.0.1:${address.port}`;
    const response=await fetch(`${origin}/auth/callback`,{redirect:'manual'});
    expect(response.status).toBe(307);expect(response.headers.get('location')).toBe(headers.get('location'));expect(response.headers.get('x-clerk-auth-reason')).toBe('session-token-expired');
  });

  it('verifies Clerk webhook signatures and rejects tampering',async()=>{
    const key=randomBytes(32),secret=`whsec_${key.toString('base64')}`,id='msg_test',timestamp=Math.floor(Date.now()/1000).toString();
    const body=JSON.stringify({data:{id:'user_a',banned:false,locked:false,primary_email_address_id:'email_a',email_addresses:[{id:'email_a',email_address:'Student@Example.Test',verification:{status:'verified',strategy:'email_code'}}]},object:'event',type:'user.updated'});
    const signature=createHmac('sha256',key).update(`${id}.${timestamp}.${body}`).digest('base64');
    const request=(value:string)=>new Request('https://lab.example/auth/webhooks/clerk',{method:'POST',headers:{'content-type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':`v1,${signature}`},body:value});
    const verifier=new ClerkIdentityWebhookVerifier(secret);
    await expect(verifier.verify(request(body))).resolves.toMatchObject({id,subject:'user_a',email:'student@example.test',disabled:false});
    await expect(verifier.verify(request(`${body} `))).rejects.toThrow();
  });

  it('requires verified provider state, exact issuer/audience, and an enabled verified-primary-email user',async()=>{
    const environment=productionRuntimeConfiguration(validEnvironment());
    const state=(issuer=environment.clerk.issuer)=>({headers:new Headers(),isAuthenticated:true,toAuth:()=>({userId:'user_a',sessionId:'sess_a',sessionClaims:{iss:issuer,aud:[environment.clerk.audience]}})});
    const user={id:'user_a',banned:false,locked:false,primaryEmailAddressId:'email_a',emailAddresses:[{id:'email_a',emailAddress:'A@Example.Test',verification:{status:'verified'}}]};
    let current=state(),revoked='';
    const clerk={authenticateRequest:async()=>current,users:{getUser:async()=>user},sessions:{revokeSession:async(id:string)=>{revoked=id;}}} as unknown as ClerkClient;
    const verifier=new ClerkExternalIdentityVerifier(clerk,environment.clerk);
    await expect(verifier.verify(new Request(environment.appOrigin))).resolves.toEqual({provider:'clerk',subject:'user_a',email:'a@example.test'});
    await verifier.revoke(new Request(environment.appOrigin));expect(revoked).toBe('sess_a');
    current=state('https://wrong-issuer.example');
    await expect(verifier.verify(new Request(environment.appOrigin))).resolves.toBeNull();
  });
});
