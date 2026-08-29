import { createClerkClient } from '@clerk/backend';
import { PrismaClient } from '@prisma/client';
import { PreviewProvisioningService } from '../apps/web/preview-provisioning.js';

const option=(name:string)=>{const index=process.argv.indexOf(`--${name}`);const value=index>=0?process.argv[index+1]?.trim():undefined;if(!value)throw new Error(`Missing --${name}`);return value;};
const origin=option('origin');
if(new URL(origin).origin!==origin)throw new Error('--origin must be an exact origin');
const secretKey=process.env.CLERK_SECRET_KEY?.trim();
if(!secretKey)throw new Error('CLERK_SECRET_KEY is required');
const prisma=new PrismaClient();
try{
  const service=new PreviewProvisioningService(prisma,createClerkClient({secretKey}),`${origin}/auth/callback`);
  const invitation=await service.invite({studentId:option('student-id'),displayName:option('display-name'),email:option('email')});
  console.log(`Preview invitation ready: ${invitation.id} (${invitation.status})`);
}finally{await prisma.$disconnect();}
