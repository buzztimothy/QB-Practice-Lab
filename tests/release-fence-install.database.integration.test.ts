import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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
      for(const f of migrationFiles().filter(f=>f.name!==fenceMigration))cpSync(`prisma/migrations/${f.name}`,join(root,'migrations',f.name),{recursive:true});
      migrate(join(root,'schema.prisma'));
      await db.$transaction(tx=>applyPreviewRuntimeGrants(tx));
      await bootstrapCanonicalLab(db);
      await db.runtimeStudent.create({data:{id:'disposable-student',displayName:'Disposable fixture',status:'INVITED'}});
      await db.previewInvitation.create({data:{studentId:'disposable-student',email:'fixture@example.invalid',status:'SENT',providerInvitationId:'inv_fixture'}});
      const ledger=()=>db.$queryRaw<LedgerRow[]>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations`;
      validateLedger(await ledger(),migrationFiles());
      let called=false;
      await expect(withPreviewReleaseLock(db,url!,'deployment',async()=>{called=true;})).rejects.toThrow();
      expect(called).toBe(false);
      const before=await installIntegrity(db);
      migrate(resolve('prisma/schema.prisma'));
      await verifyInstalled(db);
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
