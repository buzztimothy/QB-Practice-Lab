import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freezeConfirmation, migrationFiles, validateDispatch, validateIdleRuns, validateLedger, fenceMigration } from '../scripts/release-fence-install.js';

describe('one-time fence installer guards',()=>{
  let reviewedRoot:string;
  let files:ReturnType<typeof migrationFiles>;
  let rows:ReturnType<typeof ledger>;
  const ledger=(source: typeof files)=>source.map(f=>({migration_name:f.name,checksum:f.checksum,finished_at:new Date(),rolled_back_at:null}));
  beforeAll(()=>{
    reviewedRoot=mkdtempSync(join(tmpdir(),'qb-fence-reviewed-'));
    cpSync('prisma/migrations',reviewedRoot,{recursive:true});
    for(const {name} of migrationFiles(reviewedRoot)) {
      const path=join(reviewedRoot,name,'migration.sql');
      writeFileSync(path,readFileSync(path,'utf8').replaceAll('\r\n','\n'));
    }
    files=migrationFiles(reviewedRoot);
    rows=ledger(files.filter(f=>f.name!==fenceMigration));
  });
  afterAll(()=>rmSync(reviewedRoot,{recursive:true,force:true}));
  it('accepts precisely the fence as pending and rejects already installed or extra pending migrations',()=>{
    expect(()=>validateLedger(rows,files)).not.toThrow();
    expect(()=>validateLedger(rows.slice(1),files)).toThrow();
    const all=ledger(files);
    expect(()=>validateLedger(all,files)).toThrow();
    expect(()=>validateLedger(all,files,true)).not.toThrow();
  });
  it('accepts only the three recorded CRLF hashes derived from their pinned LF bytes',()=>{
    const recorded = new Map([
      ['202608190001_p000a_operations','e016c75003f07d131ad47bf6d8b45a48ce7535c0220f26046bed3fd2d4fda1ea'],
      ['202608270001_d000_durable_runtime','1e60640ce01cdb6cd7bb5ea924e45054f6be3b39786bc92b1593aedeb8486d22'],
      ['202608280001_d002_preview_auth','af18c9291b58bcabed8ecc3d8ef297b7ccbd218b41632cb22d3ec083b0847e53'],
    ]);
    const root=mkdtempSync(join(tmpdir(),'qb-fence-checksums-'));
    try {
      cpSync(reviewedRoot,root,{recursive:true});
      const path=(name:string)=>join(root,name,'migration.sql');
      const reviewed=migrationFiles(root);
      const applied=ledger(reviewed.filter(f=>f.name!==fenceMigration)).map(row=>({
        ...row,checksum:recorded.get(row.migration_name)??row.checksum,
      }));
      expect(()=>validateLedger(applied,reviewed)).not.toThrow();
      for(const name of recorded.keys()) {
        const sql=readFileSync(path(name),'utf8');
        for(const drift of [sql+'\nSELECT 1;\n',sql.replaceAll('\n','\r\n')]) {
          writeFileSync(path(name),drift);
          expect(()=>validateLedger(applied,migrationFiles(root))).toThrow();
        }
        writeFileSync(path(name),sql);
        const unknownHash=applied.map(row=>row.migration_name===name?{...row,checksum:'0'.repeat(64)}:row);
        expect(()=>validateLedger(unknownHash,reviewed)).toThrow();
      }
      const name=[...recorded.keys()][0];
      cpSync(join(root,name),join(root,'unexpected'),{recursive:true});
      const renamed=applied.map(row=>row.migration_name===name?{...row,migration_name:'unexpected'}:row);
      expect(()=>validateLedger(renamed,migrationFiles(root).filter(file=>file.name!==name))).toThrow();
      const fence={...ledger(reviewed.filter(f=>f.name===fenceMigration))[0],checksum:recorded.get(name)!};
      expect(()=>validateLedger([...applied,fence],reviewed,true)).toThrow();
    } finally {
      rmSync(root,{recursive:true,force:true});
    }
  });
  it('rejects failures, incomplete entries, checksum drift, duplicate and unknown history',()=>{
    for(const patch of [{finished_at:null},{rolled_back_at:new Date()},{checksum:'wrong'},{migration_name:'unknown'}]) expect(()=>validateLedger([{...rows[0],...patch},...rows.slice(1)],files)).toThrow();
    expect(()=>validateLedger([...rows,rows[0]],files)).toThrow();
    expect(()=>validateLedger(rows,[...files,{name:'extra',checksum:'extra'}])).toThrow();
  });
  const env={GITHUB_REPOSITORY:'buzztimothy/QB-Practice-Lab',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',APPROVED_SHA:'a'.repeat(40),GITHUB_SHA:'a'.repeat(40),OPERATOR_FREEZE:freezeConfirmation};
  it('requires first manual main run, exact SHA and explicit external-operator freeze',()=>{
    expect(()=>validateDispatch(env)).not.toThrow();
    for(const patch of [{GITHUB_REF:'refs/heads/feature'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'push'},{GITHUB_SHA:'b'.repeat(40)},{OPERATOR_FREEZE:''},{GITHUB_REPOSITORY:'other/repo'}])expect(()=>validateDispatch({...env,...patch})).toThrow();
  });
  it('rejects competing runs and truncated run inventory',()=>{
    expect(()=>validateIdleRuns({total_count:1,workflow_runs:[{id:10}]},'10')).not.toThrow();
    expect(()=>validateIdleRuns({total_count:1,workflow_runs:[{id:11}]},'10')).toThrow();
    expect(()=>validateIdleRuns({total_count:101,workflow_runs:[]},'10')).toThrow();
  });
});
