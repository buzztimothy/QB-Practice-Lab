import { createClerkClient } from '@clerk/backend';
import { PrismaClient } from '@prisma/client';
import { PreviewProvisioningService } from '../apps/web/preview-provisioning.js';
import { clerkAccountPortalUrl } from '../apps/web/clerk-account-portal.js';

const option=(name:string)=>{const index=process.argv.indexOf(`--${name}`);const value=index>=0?process.argv[index+1]?.trim():undefined;if(!value)throw new Error(`Missing --${name}`);return value;};
let prisma:PrismaClient|undefined;
try{
  const origin=option('origin');
  if(new URL(origin).origin!==origin)throw new Error('--origin must be an exact origin');
  const invitationRedirect=clerkAccountPortalUrl(process.env.CLERK_SIGN_IN_URL,origin,'sign-up');
  const secretKey=process.env.CLERK_SECRET_KEY?.trim();
  if(!secretKey)throw new Error('CLERK_SECRET_KEY is required');
  prisma=new PrismaClient();
  const service=new PreviewProvisioningService(prisma,createClerkClient({secretKey}),invitationRedirect);
  const invitation=await service.invite({studentId:option('student-id'),displayName:option('display-name'),email:option('email')});
  console.log(`Preview invitation ready: ${invitation.id} (${invitation.status})`);
}catch{
  // Provider errors can contain invitation URLs or other protected material.
  console.error('Preview invitation failed; inspect bounded state before retrying.');
  process.exitCode=1;
}finally{
  try{await prisma?.$disconnect();}catch{console.error('Preview invitation disconnect failed; inspect bounded state before retrying.');process.exitCode=1;}
}
