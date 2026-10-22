import { describe, expect, it } from 'vitest';
import { freezeConfirmation, migrationFiles, validateDispatch, validateIdleRuns, validateLedger, fenceMigration } from '../scripts/release-fence-install.js';

describe('one-time fence installer guards',()=>{
  const files=migrationFiles();
  const rows=files.filter(f=>f.name!==fenceMigration).map(f=>({migration_name:f.name,checksum:f.checksum,finished_at:new Date(),rolled_back_at:null}));
  it('accepts precisely the fence as pending and rejects already installed or extra pending migrations',()=>{
    expect(()=>validateLedger(rows,files)).not.toThrow();
    expect(()=>validateLedger(rows.slice(1),files)).toThrow();
    const all=files.map(f=>({migration_name:f.name,checksum:f.checksum,finished_at:new Date(),rolled_back_at:null}));
    expect(()=>validateLedger(all,files)).toThrow();
    expect(()=>validateLedger(all,files,true)).not.toThrow();
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
