import { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';
import { assertPreviewTlsTarget, diagnosePreviewTls, verifySessionTls } from '../scripts/preview-tls-preflight.js';
import { recoveryScope } from '../scripts/recovery-workflow.js';

describe('Preview TLS preflight',()=>{
  const host=recoveryScope.databaseHost;
  const base=`postgresql://bbb_preview_deploy_lp:fixture@${host}/bbb_practice_preview`;
  it('requires the approved direct target and a single explicit TLS requirement',()=>{
    expect(()=>assertPreviewTlsTarget(base+'?sslmode=require',host)).not.toThrow();
    for(const invalid of [
      base, base+'?sslmode=prefer', base+'?sslmode=require&sslmode=disable',
      base+'?sslmode=require&sslmode=require', base+'?sslmode=require&sslaccept=accept_invalid_certs',
      base+'?sslmode=require&options=ignored', base+'?sslmode=require&pgbouncer=true',
      base+'?sslmode=require&host=%2Ftmp',
      base+'?sslmode=require&schema=other', base.replace(host,'wrong.invalid')+'?sslmode=require',
      base.replace('bbb_preview_deploy_lp','wrong')+'?sslmode=require',
      base.replace('bbb_practice_preview','wrong')+'?sslmode=require',
    ]) expect(()=>assertPreviewTlsTarget(invalid,host)).toThrow();
    expect(()=>assertPreviewTlsTarget(base+'?sslmode=require',undefined)).toThrow();
  });
  it('fails closed on false, NULL, missing or ambiguous TLS status and query failure',async()=>{
    const query=vi.fn<Parameters<typeof verifySessionTls>[0]['$queryRaw']>();
    const verify=()=>verifySessionTls({$queryRaw:query},'test_database','test_role');
    for(const rows of [[{ssl:false}],[{ssl:null}],[],[{ssl:true},{ssl:true}]]) {
      query.mockResolvedValueOnce(rows);
      await expect(verify()).resolves.toBe(false);
    }
    query.mockRejectedValueOnce(new Error('disposable connection error'));
    await expect(verify()).rejects.toThrow();
  });
  it('classifies each stage without returning provider details',async()=>{
    const env={DIRECT_DATABASE_URL:base+'?sslmode=require',PREVIEW_DATABASE_HOST:host};
    const secretError=new Error('postgresql://fixture:fake-secret@private.invalid/database');
    const client={
      $connect:vi.fn(async()=>{}),
      $disconnect:vi.fn(async()=>{}),
      $queryRaw:vi.fn<() => Promise<{databaseMatches:boolean;roleMatches:boolean;ssl:boolean|null}[]>>(),
    };
    const create=()=>client;
    expect(await diagnosePreviewTls({},create)).toBe(10);
    expect(client.$connect).not.toHaveBeenCalled();
    expect(await diagnosePreviewTls(env,()=>{throw secretError;})).toBe(16);
    client.$connect.mockRejectedValueOnce(secretError);
    expect(await diagnosePreviewTls(env,create)).toBe(11);
    client.$queryRaw.mockRejectedValueOnce(secretError);
    expect(await diagnosePreviewTls(env,create)).toBe(12);
    for(const [rows,code] of [
      [[{databaseMatches:true,roleMatches:true,ssl:true}],0],
      [[{databaseMatches:false,roleMatches:true,ssl:true}],13],
      [[{databaseMatches:true,roleMatches:false,ssl:true}],13],
      [[{databaseMatches:true,roleMatches:true,ssl:false}],14],
      [[{databaseMatches:true,roleMatches:true,ssl:null}],15],
      [[],15],
    ] as const) {
      client.$queryRaw.mockResolvedValueOnce([...rows]);
      expect(await diagnosePreviewTls(env,create)).toBe(code);
    }
    client.$queryRaw.mockResolvedValueOnce([{databaseMatches:true,roleMatches:true,ssl:true}]);
    client.$disconnect.mockRejectedValueOnce(secretError);
    expect(await diagnosePreviewTls(env,create)).toBe(16);
  });
});

const fixture=process.env.TLS_PREFLIGHT_TEST_DATABASE_URL;
if(fixture)assertDisposableTestDatabase(fixture,process.env.DATABASE_LIFECYCLE_MARKER);
it.skipIf(!fixture)('distinguishes TLS and plaintext on real disposable PostgreSQL sessions',async()=>{
  for(const [mode,expected] of [['require',true],['disable',false]] as const) {
    const url=new URL(fixture!);
    url.searchParams.set('sslmode',mode);
    const db=new PrismaClient({datasources:{db:{url:url.href}}});
    try {
      const database=decodeURIComponent(url.pathname.slice(1));
      const role=decodeURIComponent(url.username);
      await expect(verifySessionTls(db,database,role)).resolves.toBe(expected);
      await expect(verifySessionTls(db,database,'unexpected_role')).resolves.toBe(false);
      const env={
        DIRECT_DATABASE_URL:`postgresql://bbb_preview_deploy_lp:fixture@${recoveryScope.databaseHost}/bbb_practice_preview?sslmode=require`,
        PREVIEW_DATABASE_HOST:recoveryScope.databaseHost,
      };
      // Keep the production target guard intact while replacing only the client
      // with a disposable database whose name intentionally fails live identity.
      await expect(diagnosePreviewTls(env,()=>db)).resolves.toBe(13);
      const badPassword=new URL(url);
      badPassword.password='deliberately_wrong_fixture_password';
      await expect(diagnosePreviewTls(env,()=>new PrismaClient({datasources:{db:{url:badPassword.href}}}))).resolves.toBe(11);
    } finally {
      await db.$disconnect();
    }
  }
});
