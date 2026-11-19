import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MigrationProcessError, prismaProbeSql, runFenceMigration, runReadOnlyPrismaProbe } from '../scripts/fence-migration-process.js';

function fixture() {
  const child=new ChildProcess();
  const stdout=new PassThrough(), stderr=new PassThrough();
  Object.assign(child,{stdout,stderr});
  const launch=vi.fn(()=>child);
  return {child,stdout,stderr,launch};
}

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe('bounded migration subprocess diagnostics',()=>{
  const url='postgresql://fixture:fake-password@private.invalid/disposable_test?sslmode=require&sslaccept=strict';
  const env={PATH:'fixture-path',HOME:'fixture-home',GH_TOKEN:'never-forward',CLERK_SECRET_KEY:'never-forward'};
  it('preserves the fixed operation, working directory, strict URL, minimal environment and deadline',async()=>{
    const f=fixture();
    const run=runFenceMigration(url,env,f.launch);
    f.child.emit('spawn');
    f.stdout.write('normal success');
    f.child.emit('close',0,null);
    await expect(run).resolves.toBeUndefined();
    expect(f.launch.mock.calls[0]).toEqual(['pnpm',['exec','prisma','migrate','deploy'],{
      cwd:process.cwd(),env:{PATH:env.PATH,HOME:env.HOME,DATABASE_URL:url},
      stdio:['ignore','pipe','pipe'],timeout:120_000,
    }]);
  });
  it.each([
    ['P1000','MIGRATION_CONNECTION_FAILED'],['P1001','MIGRATION_CONNECTION_FAILED'],
    ['P1011','MIGRATION_TLS_FAILED'],['P1002','MIGRATION_TIMEOUT'],
    ['P1012','MIGRATION_CONFIGURATION_FAILED'],['P3018','MIGRATION_SQL_FAILED'],
    ['P3009','MIGRATION_HISTORY_FAILED'],['P9999','MIGRATION_UNKNOWN_FAILED'],
  ])('maps %s to a fixed classification while discarding payloads',async(code,classification)=>{
    const f=fixture();
    const run=runFenceMigration(url,env,f.launch).catch(error=>error);
    f.child.emit('spawn');
    f.stderr.write('\u001b[31mError: '+code.slice(0,2));
    f.stderr.end(code.slice(2)+'\u001b[0m\n'+url+'\nSQL PRIVATE PAYLOAD');
    f.child.emit('close',1,null);
    const error=await run;
    expect(error).toBeInstanceOf(MigrationProcessError);
    expect(error.message).toBe(classification);
    expect(JSON.stringify(error)).not.toMatch(/fake-password|private.invalid|PAYLOAD/);
  });
  it('recognizes explicit engine exit evidence and treats unrecognized output as unknown',async()=>{
    for(const [output,classification] of [
      ['Error: Schema engine exited. private details','MIGRATION_ENGINE_FAILED'],
      ['SQL contains P1011 without a CLI header','MIGRATION_UNKNOWN_FAILED'],
      ['Error: unrecognized failure\nProvider response: private\nError: P1011','MIGRATION_UNKNOWN_FAILED'],
      ['Error: P3018\nDatabase response contains Error: P1011','MIGRATION_SQL_FAILED'],
      ['x'.repeat(65_536)+'\nError: P1011','MIGRATION_UNKNOWN_FAILED'],
    ]) {
      const f=fixture();
      const run=runFenceMigration(url,env,f.launch).catch(error=>error);
      f.stderr.end(output);
      f.child.emit('close',1,null);
      expect((await run).classification).toBe(classification);
    }
  });
  it('distinguishes startup, signal, timeout and unreadable output without guessing from exit codes',async()=>{
    const thrown=await runFenceMigration(url,env,()=>{throw new Error(url);}).catch(error=>error);
    expect(thrown.classification).toBe('MIGRATION_SUBPROCESS_START_FAILED');
    const start=fixture();
    const startRun=runFenceMigration(url,env,start.launch).catch(error=>error);
    start.child.emit('error',new Error(url));
    start.child.emit('close',-2,null);
    expect((await startRun).classification).toBe('MIGRATION_SUBPROCESS_START_FAILED');
    const signal=fixture();
    const signalRun=runFenceMigration(url,env,signal.launch).catch(error=>error);
    signal.child.emit('close',null,'SIGTERM');
    expect((await signalRun).classification).toBe('MIGRATION_SUBPROCESS_SIGNALLED');
    const unreadable=fixture();
    const unreadableRun=runFenceMigration(url,env,unreadable.launch).catch(error=>error);
    unreadable.stderr.emit('error',new Error(url));
    unreadable.child.emit('close',1,null);
    expect((await unreadableRun).classification).toBe('MIGRATION_UNKNOWN_FAILED');
    vi.useFakeTimers();
    const timeout=fixture();
    const timeoutRun=runFenceMigration(url,env,timeout.launch).catch(error=>error);
    await vi.advanceTimersByTimeAsync(120_000);
    timeout.child.emit('close',null,'SIGTERM');
    expect((await timeoutRun).classification).toBe('MIGRATION_TIMEOUT');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('fixes the probe command, SELECT-only stdin and minimal environment independently of migration execution',async()=>{
    const f=fixture(), stdin=new PassThrough();
    Object.assign(f.child,{stdin});
    let input='';
    stdin.on('data',chunk=>{input+=chunk.toString();});
    const run=runReadOnlyPrismaProbe(url,{...env,PROBE_SQL:'DROP TABLE private',PROBE_COMMAND:'migrate deploy'},f.launch);
    await new Promise(resolve=>setImmediate(resolve));
    f.child.emit('close',0,null);
    await expect(run).resolves.toBeUndefined();
    expect(input).toBe(`SELECT 1 / CASE
  WHEN current_database() = 'bbb_practice_preview'
   AND current_user = 'bbb_preview_deploy_lp'
  THEN 1 ELSE 0
END;`);
    expect(input).toBe(prismaProbeSql);
    expect(f.launch.mock.calls[0]).toEqual(['pnpm',[
      'exec','prisma','db','execute','--schema','prisma/schema.prisma','--stdin',
    ],{
      cwd:process.cwd(),env:{PATH:env.PATH,HOME:env.HOME,DATABASE_URL:url},
      stdio:['pipe','pipe','pipe'],timeout:120_000,
    }]);
  });
  it('fails the probe closed on missing stdin or truncated output even with exit zero',async()=>{
    for(const missingStdin of [true,false]) {
      const f=fixture(),stdin=new PassThrough();
      if(!missingStdin)Object.assign(f.child,{stdin});
      const run=runReadOnlyPrismaProbe(url,env,f.launch).catch(error=>error);
      await new Promise(resolve=>setImmediate(resolve));
      if(!missingStdin)f.stdout.write('x'.repeat(40_000));
      f.child.emit('close',0,null);
      expect((await run).classification).toBe('MIGRATION_UNKNOWN_FAILED');
    }
  });
});
