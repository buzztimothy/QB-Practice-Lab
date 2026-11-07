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
