import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';
import { fenceMigration, installIntegrity, migrationFiles, validateLedger, verifyDatabaseIdle, verifyInstalled, type LedgerRow } from '../scripts/release-fence-install.js';
import { applyPreviewRuntimeGrants } from '../scripts/preview-runtime-grants.js';
import { bootstrapCanonicalLab } from '../apps/student/persistence.js';
import { withPreviewReleaseLock } from '../scripts/preview-release-lock.js';

const url=process.env.FENCE_INSTALL_TEST_DATABASE_URL;
if(url)assertDisposableTestDatabase(url,process.env.DATABASE_LIFECYCLE_MARKER);
const suite=url?describe:describe.skip;
suite('one-time migration on empty disposable deploy-role database',()=>{
  const db=new PrismaClient(url?{datasources:{db:{url}}}:undefined);
  afterAll(async()=>{await db.$disconnect();});
  it('upgrades through Prisma ledger, retains every existing row, restricts permissions and refuses repeat installation',async()=>{
    const root=mkdtempSync(join(tmpdir(),'qb-fence-install-'));
    const migrate=(schema:string)=>execFileSync(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy','--schema',schema],{env:{...process.env,DATABASE_URL:url},stdio:'pipe'});
    try{
      cpSync('prisma/schema.prisma',join(root,'schema.prisma'));
      mkdirSync(join(root,'migrations'));
      cpSync('prisma/migrations/migration_lock.toml',join(root,'migrations/migration_lock.toml'));
      const reviewedRoot=join(root,'reviewed');
      cpSync('prisma/migrations',reviewedRoot,{recursive:true});
      for(const {name} of migrationFiles(reviewedRoot)) {
        const path=join(reviewedRoot,name,'migration.sql');
        writeFileSync(path,readFileSync(path,'utf8').replaceAll('\r\n','\n'));
      }
      const reviewed=migrationFiles(reviewedRoot);
      for(const f of reviewed.filter(f=>f.name!==fenceMigration)) {
        const target=join(root,'migrations',f.name);
        mkdirSync(target);
        const sql=readFileSync(join(reviewedRoot,f.name,'migration.sql'),'utf8');
        writeFileSync(join(target,'migration.sql'),f.compatibleChecksum?sql.replaceAll('\n','\r\n'):sql);
      }
      migrate(join(root,'schema.prisma'));
      await db.$transaction(tx=>applyPreviewRuntimeGrants(tx));
      await bootstrapCanonicalLab(db);
      await db.runtimeStudent.create({data:{id:'disposable-student',displayName:'Disposable fixture',status:'INVITED'}});
      await db.previewInvitation.create({data:{studentId:'disposable-student',email:'fixture@example.invalid',status:'SENT',providerInvitationId:'inv_fixture'}});
      const ledger=()=>db.$queryRaw<LedgerRow[]>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations`;
      const applied=await ledger();
      expect(reviewed.filter(f=>applied.some(row=>row.migration_name===f.name && row.checksum!==f.checksum)).map(f=>f.name).sort()).toEqual([
        '202608190001_p000a_operations','202608270001_d000_durable_runtime','202608280001_d002_preview_auth',
      ]);
      validateLedger(applied,reviewed);
      let called=false;
      await expect(withPreviewReleaseLock(db,url!,'deployment',async()=>{called=true;})).rejects.toThrow();
      expect(called).toBe(false);
      const before=await installIntegrity(db);
      cpSync(join(reviewedRoot,fenceMigration),join(root,'migrations',fenceMigration),{recursive:true});
      migrate(join(root,'schema.prisma'));
      await verifyInstalled(db,reviewed);
      expect(await installIntegrity(db)).toBe(before);
      expect(()=>validateLedger([],migrationFiles())).toThrow();
      const installed=await ledger();
      expect(()=>validateLedger(installed,migrationFiles())).toThrow();
      await withPreviewReleaseLock(db,url!,'preflight',async()=>{});
      await db.previewInvitation.updateMany({data:{providerInvitationId:'inv_drift'}});
      expect(await installIntegrity(db)).not.toBe(before);
    }finally{rmSync(root,{recursive:true,force:true});}
  },60_000);
  it('rejects a competing operator on a separate PostgreSQL connection',async()=>{
    const competitor=new PrismaClient({datasources:{db:{url:url!}}});
    try{
      await db.$transaction(async tx=>{
        await verifyDatabaseIdle(tx);
        await competitor.$transaction(async other=>{
          await other.$queryRaw`SELECT pg_try_advisory_xact_lock(6982806162030449104)`;
          await expect(verifyDatabaseIdle(tx)).rejects.toThrow();
        });
      });
    }finally{await competitor.$disconnect();}
  });
});
