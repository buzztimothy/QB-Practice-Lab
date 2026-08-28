import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assertPreviewDeployDatabase } from './database-target-guard.js';

const direct=process.env.DIRECT_DATABASE_URL?.trim();
if(!direct)throw new Error('DIRECT_DATABASE_URL is required');
assertPreviewDeployDatabase(direct,process.env.PREVIEW_DATABASE_CONFIRMATION);
process.env.DATABASE_URL=direct;
const run=(command:string,args:string[])=>new Promise<void>((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',env:process.env,shell:process.platform==='win32'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${command} exited ${code}`)));});
const prisma=new PrismaClient();
try{
  await prisma.$transaction(async tx=>{
    const deadline=Date.now()+300_000;
    while(true){
      const [row]=await tx.$queryRawUnsafe<{locked:boolean}[]>('SELECT pg_try_advisory_xact_lock(6982806162030449104) AS locked');
      if(row?.locked)break;
      if(Date.now()>=deadline)throw new Error('Timed out waiting for Preview deployment lock');
      await new Promise(resolve=>setTimeout(resolve,5_000));
    }
    await run('pnpm',['exec','prisma','migrate','deploy']);
    await run('node',['dist/scripts/bootstrap-canonical.js']);
    await run('node',['dist/scripts/bootstrap-canonical.js']);
  },{timeout:600_000});
}finally{await prisma.$disconnect();}
