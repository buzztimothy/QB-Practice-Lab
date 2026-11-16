import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { diagnosePreviewTls } from '../scripts/preview-tls-preflight.js';
import { strictPreviewDatabaseUrl } from '../scripts/strict-preview-connection.js';
import { recoveryScope } from '../scripts/recovery-workflow.js';

const host=recoveryScope.databaseHost;
const base=`postgresql://bbb_preview_deploy_lp:fixture@${host}/bbb_practice_preview`;

describe('strict Preview connection policy',()=>{
  it('validates the original target and derives strict TLS without changing identity or the input',()=>{
    const input=base+'?sslmode=require&schema=public&connection_limit=1&connect_timeout=10&channel_binding=require';
    const strict=new URL(strictPreviewDatabaseUrl(input,host));
    expect(strict.searchParams.getAll('sslmode')).toEqual(['require']);
    expect(strict.searchParams.getAll('sslaccept')).toEqual(['strict']);
    expect(strict.hostname).toBe(host);
    expect(strict.pathname).toBe('/bbb_practice_preview');
    expect(strict.username).toBe('bbb_preview_deploy_lp');
    expect(strict.searchParams.get('connect_timeout')).toBe('10');
    expect(input).not.toContain('sslaccept');
  });
  it('rejects unexpected, duplicate or weakening options before constructing a client',()=>{
    for(const query of [
      '', '?sslmode=prefer', '?sslmode=verify-full', '?sslmode=require&sslmode=disable',
      '?sslmode=require&sslmode=require', '?sslmode=require&sslaccept=strict',
      '?sslmode=require&sslaccept=accept_invalid_certs', '?sslmode=require&sslcert=untrusted.pem',
      '?sslmode=require&sslrootcert=untrusted.pem', '?sslmode=require&sslidentity=client.p12',
      '?sslmode=require&options=ignored', '?sslmode=require&pgbouncer=true',
      '?sslmode=require&host=%2Ftmp', '?sslmode=require&hostaddr=127.0.0.1',
      '?sslmode=require&schema=other', '?sslmode=require&schema=public&schema=public',
      '?sslmode=require&connection_limit=0', '?sslmode=require&connect_timeout=-1',
      '?sslmode=require&channel_binding=disable', '?sslmode=require&unknown=value',
      '?sslmode=require#fragment',
    ]) expect(()=>strictPreviewDatabaseUrl(base+query,host)).toThrow();
    for(const target of [
      base.replace(host,'wrong.invalid'),base.replace(host,host.replace('.','-pooler.')),
      base.replace('bbb_preview_deploy_lp','wrong'),base.replace('bbb_practice_preview','wrong'),
      base.replace(host,host+':5433'),' '+base,base.replace('postgresql:','postgres:'),
    ]) expect(()=>strictPreviewDatabaseUrl(target+'?sslmode=require',host)).toThrow();
    expect(()=>strictPreviewDatabaseUrl(base+'?sslmode=require',undefined)).toThrow();
  });
  it('fails closed if the generated Prisma client or engine pin changes',()=>{
    const runtimeVersion=Prisma.prismaVersion as {client:string;engine?:string};
    const version={...runtimeVersion};
    try {
      runtimeVersion.engine='unsupported';
      expect(()=>strictPreviewDatabaseUrl(base+'?sslmode=require',host)).toThrow();
      runtimeVersion.engine=version.engine;
      runtimeVersion.client='unsupported';
      expect(()=>strictPreviewDatabaseUrl(base+'?sslmode=require',host)).toThrow();
    } finally {
      Object.assign(runtimeVersion,version);
    }
  });
  it('rejects runtime engine overrides',()=>{
    try {
      vi.stubEnv('PRISMA_QUERY_ENGINE_LIBRARY','unreviewed-library');
      expect(()=>strictPreviewDatabaseUrl(base+'?sslmode=require',host)).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('classifies failures without returning provider details and only passes exact live identity',async()=>{
    const env={DIRECT_DATABASE_URL:base+'?sslmode=require',PREVIEW_DATABASE_HOST:host};
    const secretError=new Error('postgresql://fixture:fake-secret@private.invalid/database');
    const client={
      $connect:vi.fn(async()=>{}),
      $disconnect:vi.fn(async()=>{}),
      $queryRaw:vi.fn<() => Promise<{databaseMatches:boolean;roleMatches:boolean}[]>>(),
    };
    const create=vi.fn<(url:string)=>typeof client>(()=>client);
    expect(await diagnosePreviewTls({},create)).toBe(10);
    expect(create).not.toHaveBeenCalled();
    expect(await diagnosePreviewTls(env,()=>{throw secretError;})).toBe(16);
    client.$connect.mockRejectedValueOnce(secretError);
    expect(await diagnosePreviewTls(env,create)).toBe(11);
    expect(new URL(create.mock.calls[0]?.[0]??'').searchParams.get('sslaccept')).toBe('strict');
    client.$queryRaw.mockRejectedValueOnce(secretError);
    expect(await diagnosePreviewTls(env,create)).toBe(12);
    for(const [rows,code] of [
      [[{databaseMatches:true,roleMatches:true}],0],
      [[{databaseMatches:false,roleMatches:true}],13],
      [[{databaseMatches:true,roleMatches:false}],13],
      [[],15],
      [[{databaseMatches:true,roleMatches:true},{databaseMatches:true,roleMatches:true}],15],
    ] as const) {
      client.$queryRaw.mockResolvedValueOnce([...rows]);
      expect(await diagnosePreviewTls(env,create)).toBe(code);
    }
    client.$queryRaw.mockResolvedValueOnce([{databaseMatches:true,roleMatches:true}]);
    client.$disconnect.mockRejectedValueOnce(secretError);
    expect(await diagnosePreviewTls(env,create)).toBe(16);
  });
});
