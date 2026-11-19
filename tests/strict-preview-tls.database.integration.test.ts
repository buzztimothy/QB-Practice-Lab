import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { strictPreviewDatabaseUrl } from '../scripts/strict-preview-connection.js';
import { diagnosePreviewTls } from '../scripts/preview-tls-preflight.js';
import { recoveryScope } from '../scripts/recovery-workflow.js';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';
import { runFenceMigration, runReadOnlyPrismaProbe } from '../scripts/fence-migration-process.js';

// Explicit opt-in creates only a new disposable, loopback-bound Docker service.
it.skipIf(process.env.STRICT_TLS_DISPOSABLE_TESTS!=='1')('enforces the pinned native connector certificate and TLS policy',async()=>{
  const container='qb-strict-tls-'+randomUUID();
  const root=mkdtempSync(join(tmpdir(),'qb-strict-tls-'));
  const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30_000});
  const run=(...args:string[])=>docker('exec',container,...args);
  const database='qb_tls_validation';
  const role='bbb_preview_deploy_lp';
  const fixturePassword=randomUUID();
  let started=false;
  try {
    expect(Prisma.prismaVersion).toEqual({client:'6.14.0',engine:'717184b7b35ea05dfa71a3236b7af656013e1e49'});
    docker('run','--rm','-d','--name',container,'-p','127.0.0.1::5432',
      '-e','POSTGRES_PASSWORD='+fixturePassword,'-e','POSTGRES_USER='+role,'-e','POSTGRES_DB='+database,'postgres:16');
    started=true;
    run('sh','-c','until pg_isready -h 127.0.0.1 -U bbb_preview_deploy_lp -d qb_tls_validation >/dev/null 2>&1; do sleep 1; done');
    docker('exec','-u','postgres',container,'openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
      '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost',
      '-keyout','/tmp/fixture.key','-out','/tmp/fixture.crt');
    docker('exec','-u','postgres',container,'chmod','600','/tmp/fixture.key');
    const sql=(statement:string)=>run('psql','-U',role,'-d',database,'-v','ON_ERROR_STOP=1','-c',statement);
    sql("ALTER SYSTEM SET ssl_cert_file='/tmp/fixture.crt'");
    sql("ALTER SYSTEM SET ssl_key_file='/tmp/fixture.key'");
    sql("ALTER SYSTEM SET ssl='on'");
    sql('SELECT pg_reload_conf()');
    // SHOW on a fresh backend waits for the reload to have taken effect.
    run('sh','-c',"until test \"$(psql -U bbb_preview_deploy_lp -d qb_tls_validation -Atc 'SHOW ssl')\" = on; do sleep 1; done");
    const cert=join(root,'fixture.crt');
    docker('cp',container+':/tmp/fixture.crt',cert);
    const port=docker('port',container,'5432').trim().split(':').at(-1)!;
    expect(port).toMatch(/^\d+$/);
    const env={
      DIRECT_DATABASE_URL:`postgresql://${role}:fixture@${recoveryScope.databaseHost}/bbb_practice_preview?sslmode=require`,
      PREVIEW_DATABASE_HOST:recoveryScope.databaseHost,
    };
    const strict=strictPreviewDatabaseUrl(env.DIRECT_DATABASE_URL,env.PREVIEW_DATABASE_HOST);
    const fixtureUrl=(hostname='localhost',trusted=true)=>{
      const url=new URL(strict);
      url.hostname=hostname;
      url.port=port;
      url.pathname='/'+database;
      url.password=fixturePassword;
      if(trusted)url.searchParams.set('sslcert',cert);
      assertDisposableTestDatabase(url.href,'disposable-test');
      return url.href;
    };
    const connects=async(url:string)=>{
      const db=new PrismaClient({datasources:{db:{url}}});
      try {
        const rows=await db.$queryRaw<{ok:boolean}[]>`SELECT current_database()=${database} AND current_user=${role} AS ok`;
        return rows.length===1 && rows[0].ok;
      } catch { return false; }
      finally { await db.$disconnect(); }
    };
    const schemaEngineConnects=(url:string)=>{
      try {
        // Exercise the pinned migration engine's connection handling with SELECT
        // only. No migrate command or schema/data mutation runs in this test.
        execFileSync(process.execPath,[resolve('node_modules/prisma/build/index.js'),
          'db','execute','--schema',resolve('prisma/schema.prisma'),'--stdin'],{
          env:{PATH:process.env.PATH,HOME:process.env.HOME,DATABASE_URL:url},
          input:'SELECT 1;',stdio:['pipe','pipe','pipe'],timeout:30_000,
        });
        return true;
      } catch { return false; }
    };
    const classifiedProbe=(url:string)=>runFenceMigration(url,process.env,(_command,_args,options)=>{
      // Exercise real CLI diagnostics using SELECT only. Production keeps the
      // fixed pnpm migrate deploy invocation covered by the subprocess test.
      const child=spawn(process.execPath,[resolve('node_modules/prisma/build/index.js'),
        'db','execute','--schema',resolve('prisma/schema.prisma'),'--stdin'],{
        ...options,stdio:['pipe','pipe','pipe'],
      });
      child.stdin?.end('SELECT 1;');
      return child;
    }).then(()=> 'PASS',error=>error.classification);
    expect(await connects(fixtureUrl())).toBe(true);
    expect(schemaEngineConnects(fixtureUrl())).toBe(true);
    expect(await classifiedProbe(fixtureUrl())).toBe('PASS');
    expect(await connects(fixtureUrl('127.0.0.1'))).toBe(false);
    expect(schemaEngineConnects(fixtureUrl('127.0.0.1'))).toBe(false);
    expect(await connects(fixtureUrl('localhost',false))).toBe(false);
    expect(schemaEngineConnects(fixtureUrl('localhost',false))).toBe(false);
    expect(await classifiedProbe(fixtureUrl('localhost',false))).toBe('MIGRATION_TLS_FAILED');
    const badPassword=new URL(fixtureUrl());
    badPassword.password='deliberately_wrong_fixture_password';
    expect(await classifiedProbe(badPassword.href)).toBe('MIGRATION_CONNECTION_FAILED');
    // This literal identity exists only inside our newly created Docker
    // container. No general disposable-target guard is weakened or changed.
    run('createdb','-U',role,'bbb_practice_preview');
    const exactIdentityUrl=new URL(fixtureUrl());
    exactIdentityUrl.pathname='/bbb_practice_preview';
    let launcherEvidence={empty:false,stdin:false,pnpm:false,missing:false,permission:false,schema:false,code:'NONE'};
    const readonlyProbe=(url:string)=>runReadOnlyPrismaProbe(url,process.env,(command,args,options)=>{
      // On GitHub/Linux exercise pnpm itself with the production minimal env.
      // Windows has a .cmd shim, so use the pinned CLI JS for the local test.
      const child=process.platform==='win32'
        ? spawn(process.execPath,[resolve('node_modules/prisma/build/index.js'),...args.slice(2)],options)
        : spawn(command,args,options);
      let bounded='';
      const inspect=(chunk:Buffer)=>{
        bounded=(bounded+chunk.toString('utf8')).slice(0,8192);
        launcherEvidence={empty:/empty/i.test(bounded),stdin:/stdin/i.test(bounded),
          pnpm:/ERR_PNPM_/.test(bounded),missing:/ENOENT|not found|Cannot find/i.test(bounded),
          permission:/EACCES|permission denied/i.test(bounded),schema:/schema/i.test(bounded),
          code:[
            'ERR_PNPM_UNEXPECTED_STORE','ERR_PNPM_BAD_PM_VERSION','ERR_PNPM_UNSUPPORTED_ENGINE',
            'ERR_PNPM_NO_GLOBAL_BIN_DIR','ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND',
            'ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL','ERR_PNPM_OUTDATED_LOCKFILE',
            'ERR_PNPM_LOCKFILE_CONFIG_MISMATCH','ERR_PNPM_NODE_LINKER_DIFF',
            'ERR_PNPM_HOIST_PATTERN_DIFF','ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF',
            'ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF','ERR_PNPM_CANNOT_MANAGE_NODE',
            'ERR_PNPM_NO_NODE_BIN_DIR','ERR_PNPM_CONFIG_DEP_NO_LOCKFILE',
            'ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE','ERR_PNPM_BROKEN_PNPM_INSTALL',
            'ERR_PNPM_BROKEN_PNPM_RELEASE','ERR_PNPM_CANNOT_RESOLVE_PNPM',
            'ERR_PNPM_VERIFY_DEPS_BEFORE_RUN','ERR_PNPM_NO_SHELL_EMULATOR',
            'ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH','ERR_PNPM_BAD_OPTIONS',
            'ERR_PNPM_CHILD_PROCESS_FAILED','ERR_PNPM_PROJECT_INACCESSIBLE',
            'ERR_PNPM_UNEXPECTED_VIRTUAL_STORE','ERR_PNPM_EXEC_MISSING_COMMAND',
          ].find(code=>bounded.includes(code))??'UNLISTED'};
      };
      child.stdout?.on('data',inspect);
      child.stderr?.on('data',inspect);
      return child;
    }).then(()=> 'PASS',error=>error.classification);
    expect({result:await readonlyProbe(exactIdentityUrl.href),launcherEvidence}).toEqual({
      result:'PASS',launcherEvidence:{empty:false,stdin:false,pnpm:false,missing:false,permission:false,schema:false,code:'NONE'},
    });
    expect(await readonlyProbe(fixtureUrl())).toBe('MIGRATION_UNKNOWN_FAILED');
    const untrustedProbeUrl=new URL(exactIdentityUrl);
    untrustedProbeUrl.searchParams.delete('sslcert');
    expect(await readonlyProbe(untrustedProbeUrl.href)).toBe('MIGRATION_TLS_FAILED');
    const badProbePassword=new URL(exactIdentityUrl);
    badProbePassword.password='deliberately_wrong_fixture_password';
    expect(await readonlyProbe(badProbePassword.href)).toBe('MIGRATION_CONNECTION_FAILED');
    const probeDb=new PrismaClient({datasources:{db:{url:exactIdentityUrl.href}}});
    try {
      expect(await probeDb.$queryRaw`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'`)
        .toEqual([{count:0}]);
      expect(await probeDb.$queryRaw`SELECT to_regclass('public._prisma_migrations') IS NULL AS absent`)
        .toEqual([{absent:true}]);
    } finally { await probeDb.$disconnect(); }
    // The production guard remains exact. The injected client targets only the
    // disposable DB, so its live identity must fail even with valid TLS.
    expect(await diagnosePreviewTls(env,()=>new PrismaClient({datasources:{db:{url:fixtureUrl()}}}))).toBe(13);
    sql("ALTER SYSTEM SET ssl='off'");
    sql('SELECT pg_reload_conf()');
    run('sh','-c',"until test \"$(psql -U bbb_preview_deploy_lp -d qb_tls_validation -Atc 'SHOW ssl')\" = off; do sleep 1; done");
    expect(await connects(fixtureUrl())).toBe(false);
    expect(schemaEngineConnects(fixtureUrl())).toBe(false);
    expect(await diagnosePreviewTls(env,()=>new PrismaClient({datasources:{db:{url:fixtureUrl()}}}))).toBe(11);
  } finally {
    if(started)docker('stop',container);
    rmSync(root,{recursive:true,force:true});
  }
},180_000);
