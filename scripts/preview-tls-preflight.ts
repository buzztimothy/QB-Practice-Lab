import { PrismaClient } from '@prisma/client';
import { assertPreviewDeployDatabase, previewDatabaseName, previewDeployRole } from './database-target-guard.js';
import { recoveryScope, requireGate } from './recovery-workflow.js';

export function assertPreviewTlsTarget(url: string, host: string | undefined) {
  requireGate(host === recoveryScope.databaseHost);
  assertPreviewDeployDatabase(url, previewDatabaseName, host);
  const params = new URL(url).searchParams;
  requireGate(params.getAll('sslmode').length === 1);
  requireGate(!params.has('host'));
  requireGate(!params.has('options') && !params.has('pgbouncer') && !params.has('sslaccept'));
  requireGate(params.getAll('schema').every(schema => schema === 'public'));
}

interface TlsQueryClient {
  $queryRaw(query: TemplateStringsArray, database: string, role: string): Promise<{ssl: boolean | null}[]>;
}

export async function verifySessionTls(db: TlsQueryClient, database: string, role: string): Promise<boolean> {
  const rows = await db.$queryRaw`
    SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()
      AND current_database() = ${database} AND current_user = ${role}
  `;
  return rows.length === 1 && rows[0].ssl === true;
}

export async function runPreviewTlsPreflight(env: NodeJS.ProcessEnv): Promise<boolean> {
  const url = env.DIRECT_DATABASE_URL ?? '';
  assertPreviewTlsTarget(url, env.PREVIEW_DATABASE_HOST);
  const db = new PrismaClient({datasources:{db:{url}}});
  try {
    return await verifySessionTls(db, previewDatabaseName, previewDeployRole);
  } finally {
    await db.$disconnect();
  }
}

// Only numeric classifications cross the credentialed process boundary.
export const tlsPreflightExit = Object.freeze({
  pass: 0, target: 10, connection: 11, query: 12,
  identity: 13, tlsFalse: 14, unavailable: 15, internal: 16,
});

interface DiagnosticClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRaw(query: TemplateStringsArray, database: string, role: string): Promise<{
    databaseMatches: boolean; roleMatches: boolean; ssl: boolean | null;
  }[]>;
}

export async function diagnosePreviewTls(
  env: NodeJS.ProcessEnv,
  createClient: (url: string) => DiagnosticClient = url => new PrismaClient({datasources:{db:{url}}}),
): Promise<number> {
  const url=env.DIRECT_DATABASE_URL??'';
  try { assertPreviewTlsTarget(url,env.PREVIEW_DATABASE_HOST); }
  catch { return tlsPreflightExit.target; }
  let db:DiagnosticClient;
  try { db=createClient(url); }
  catch { return tlsPreflightExit.internal; }
  let result:number=tlsPreflightExit.connection;
  try {
    await db.$connect();
    result=tlsPreflightExit.query;
    const rows=await db.$queryRaw`
      SELECT current_database() = ${previewDatabaseName} AS "databaseMatches",
             current_user = ${previewDeployRole} AS "roleMatches",
             (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl
    `;
    if(rows.length!==1) result=tlsPreflightExit.unavailable;
    else if(rows[0].databaseMatches!==true || rows[0].roleMatches!==true) result=tlsPreflightExit.identity;
    else if(rows[0].ssl===true) result=tlsPreflightExit.pass;
    else result=rows[0].ssl===false?tlsPreflightExit.tlsFalse:tlsPreflightExit.unavailable;
  } catch {
    // Preserve the stage without serializing provider errors.
  } finally {
    try { await db.$disconnect(); }
    catch { result=tlsPreflightExit.internal; }
  }
  return result;
}
