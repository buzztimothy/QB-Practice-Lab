import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assertPreviewDeployDatabase } from './database-target-guard.js';
import { applyPreviewRuntimeGrants } from './preview-runtime-grants.js';

const direct=process.env.DIRECT_DATABASE_URL?.trim();
if(!direct)throw new Error('DIRECT_DATABASE_URL is required');
assertPreviewDeployDatabase(direct,process.env.PREVIEW_DATABASE_CONFIRMATION,process.env.PREVIEW_DATABASE_HOST);
process.env.DATABASE_URL=direct;
const run=(command:string,args:string[])=>new Promise<void>((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',env:process.env,shell:process.platform==='win32'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${command} exited ${code}`)));});
const prisma=new PrismaClient();
try{
  await prisma.$transaction(async tx=>{
    const deadline=Date.now()+300_000;
    let acquired=false;
    while(true){
      const [row]=await tx.$queryRawUnsafe<{locked:boolean}[]>('SELECT pg_try_advisory_lock(6982806162030449104) AS locked');
      if(row?.locked){acquired=true;break;}
      if(Date.now()>=deadline)throw new Error('Timed out waiting for Preview deployment lock');
      await new Promise(resolve=>setTimeout(resolve,5_000));
    }
    try{
      await run('pnpm',['exec','prisma','migrate','deploy']);
      await applyPreviewRuntimeGrants(tx);
      await run('node',['dist/scripts/bootstrap-canonical.js']);
      await run('node',['dist/scripts/bootstrap-canonical.js']);
    }finally{
      if(acquired)await tx.$queryRawUnsafe('SELECT pg_advisory_unlock(6982806162030449104)');
    }
  },{timeout:600_000});
}finally{await prisma.$disconnect();}
