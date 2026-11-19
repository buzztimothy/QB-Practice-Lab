import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewPrismaProbe } from '../scripts/preview-prisma-probe.js';
import { MigrationProcessError, runReadOnlyPrismaProbe } from '../scripts/fence-migration-process.js';
import { recoveryScope } from '../scripts/recovery-workflow.js';

const fixture=vi.hoisted(()=>({sha:'a'.repeat(40),dirty:false}));
vi.mock('node:child_process',async importOriginal=>({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFileSync:(_command:string,args:string[])=>args[0]==='status'?(fixture.dirty?' M changed.ts':''):fixture.sha,
}));
vi.mock('../scripts/fence-migration-process.js',async importOriginal=>{
  const actual=await importOriginal<typeof import('../scripts/fence-migration-process.js')>();
  return {...actual,runReadOnlyPrismaProbe:vi.fn()};
});
const env={
  GITHUB_REPOSITORY:'buzztimothy/QB-Practice-Lab',GITHUB_REF:'refs/heads/main',
  GITHUB_REF_PROTECTED:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',
  GITHUB_RUN_ID:'1',GITHUB_SHA:fixture.sha,APPROVED_SHA:fixture.sha,GH_TOKEN:'fixture-token',
  OPERATOR_FREEZE:'ALL_OPERATORS_IDLE_FREEZE_UNTIL_VERIFIED',
  DIRECT_DATABASE_URL:`postgresql://bbb_preview_deploy_lp:fixture@${recoveryScope.databaseHost}/bbb_practice_preview?sslmode=require`,
  PREVIEW_DATABASE_HOST:recoveryScope.databaseHost,
};
function api(main=fixture.sha,runs={total_count:1,workflow_runs:[{id:1}]}) {
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({
    ok:true,json:async()=>url.endsWith('branches/main')?{protected:true,commit:{sha:main}}:runs,
  })));
}
afterEach(()=>{
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fixture.dirty=false;
});
describe('protected read-only Prisma probe',()=>{
  it('checks source and idle state before and after the strict child',async()=>{
    api();
    expect(await previewPrismaProbe(env)).toBe(0);
    const calls=vi.mocked(runReadOnlyPrismaProbe).mock.calls;
    expect(calls).toHaveLength(1);
    const strict=new URL(calls[0][0]);
    expect(strict.searchParams.get('sslaccept')).toBe('strict');
    expect(strict.searchParams.getAll('sslmode')).toEqual(['require']);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(12);
  });
  it('rejects invalid dispatch, stale main, competing runs, dirty source and target options before spawning',async()=>{
    api();
    for(const patch of [
      {GITHUB_REF:'refs/heads/feature'},{GITHUB_RUN_ATTEMPT:'2'},
      {GITHUB_EVENT_NAME:'push'},{GITHUB_REF_PROTECTED:'false'},
      {OPERATOR_FREEZE:''},{APPROVED_SHA:'b'.repeat(40)},{GITHUB_RUN_ID:''},{GH_TOKEN:''},
    ]) expect(await previewPrismaProbe({...env,...patch})).toBe(10);
    fixture.dirty=true;
    expect(await previewPrismaProbe(env)).toBe(10);
    fixture.dirty=false;
    api('b'.repeat(40));
    expect(await previewPrismaProbe(env)).toBe(10);
    api(fixture.sha,{total_count:2,workflow_runs:[{id:1},{id:2}]});
    expect(await previewPrismaProbe(env)).toBe(10);
    api();
    expect(await previewPrismaProbe({...env,DIRECT_DATABASE_URL:env.DIRECT_DATABASE_URL+'&options=ignored'})).toBe(21);
    expect(runReadOnlyPrismaProbe).not.toHaveBeenCalled();
  });
  it('returns only fixed classifications for subprocess/provider failures',async()=>{
    api();
    for(const [classification,code] of [
      ['MIGRATION_SUBPROCESS_START_FAILED',11],['MIGRATION_CONNECTION_FAILED',14],
      ['MIGRATION_TLS_FAILED',15],['MIGRATION_SQL_FAILED',16],['MIGRATION_ENGINE_FAILED',19],
    ] as const) {
      vi.mocked(runReadOnlyPrismaProbe).mockRejectedValueOnce(new MigrationProcessError(classification));
      expect(await previewPrismaProbe(env)).toBe(code);
    }
    vi.mocked(runReadOnlyPrismaProbe).mockRejectedValueOnce(new Error('private provider payload'));
    expect(await previewPrismaProbe(env)).toBe(20);
  });
  it('fails closed on API failure, truncated inventory or drift after successful SQL',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));
    expect(await previewPrismaProbe(env)).toBe(10);
    api(fixture.sha,{total_count:2,workflow_runs:[{id:1}]});
    expect(await previewPrismaProbe(env)).toBe(10);
    expect(runReadOnlyPrismaProbe).not.toHaveBeenCalled();
    let mainReads=0;
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>({
      ok:true,json:async()=>url.endsWith('branches/main')
        ? {protected:true,commit:{sha:++mainReads===1?fixture.sha:'b'.repeat(40)}}
        : {total_count:1,workflow_runs:[{id:1}]},
    })));
    expect(await previewPrismaProbe(env)).toBe(10);
    expect(runReadOnlyPrismaProbe).toHaveBeenCalledOnce();
  });
});
