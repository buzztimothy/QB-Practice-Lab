import { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';
import { assertPreviewTlsTarget, verifySessionTls } from '../scripts/preview-tls-preflight.js';
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
    } finally {
      await db.$disconnect();
    }
  }
});
