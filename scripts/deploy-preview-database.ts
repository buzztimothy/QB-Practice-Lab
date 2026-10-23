import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assertPreviewDeployDatabase } from './database-target-guard.js';
import { applyPreviewRuntimeGrants } from './preview-runtime-grants.js';
import { withPreviewReleaseLock } from './preview-release-lock.js';

const direct=process.env.DIRECT_DATABASE_URL?.trim();
if(!direct)throw new Error('DIRECT_DATABASE_URL is required');
assertPreviewDeployDatabase(direct,process.env.PREVIEW_DATABASE_CONFIRMATION,process.env.PREVIEW_DATABASE_HOST);
process.env.DATABASE_URL=direct;
const run=(command:string,args:string[])=>new Promise<void>((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',env:process.env,shell:process.platform==='win32'});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('DEPLOY_CHILD_FAILED')));});
const prisma=new PrismaClient();
try{
  await withPreviewReleaseLock(prisma,direct,'deployment',async()=>{
      await run('pnpm',['exec','prisma','migrate','deploy']);
      await prisma.$transaction(tx=>applyPreviewRuntimeGrants(tx));
      await run('node',['dist/scripts/bootstrap-canonical.js']);
      await run('node',['dist/scripts/bootstrap-canonical.js']);
  });
}catch{
  console.error('PREVIEW_DEPLOYMENT_BLOCKED_INSPECTION_REQUIRED_NO_RETRY');
  process.exitCode=1;
}finally{await prisma.$disconnect();}
