import { Prisma } from '@prisma/client';
import { assertPreviewDeployDatabase, previewDatabaseName } from './database-target-guard.js';
import { recoveryScope, requireGate } from './recovery-workflow.js';

const timeoutOptions = new Set(['connect_timeout', 'pool_timeout', 'socket_timeout']);

export function strictPreviewDatabaseUrl(connection: string, expectedHost: string | undefined): string {
  requireGate(expectedHost === recoveryScope.databaseHost);
  assertPreviewDeployDatabase(connection, previewDatabaseName, expectedHost);
  const url = new URL(connection);
  requireGate(!url.hash && (!url.port || url.port === '5432'));
  const seen = new Set<string>();
  for (const [name, value] of url.searchParams) {
    requireGate(!seen.has(name));
    seen.add(name);
    if (name === 'sslmode') requireGate(value === 'require');
    else if (name === 'schema') requireGate(value === 'public');
    else if (name === 'channel_binding') requireGate(value === 'require');
    else if (name === 'connection_limit') requireGate(/^[1-9][0-9]*$/.test(value));
    else if (timeoutOptions.has(name)) requireGate(/^(0|[1-9][0-9]*)$/.test(value));
    else requireGate(false);
  }
  requireGate(seen.has('sslmode'));
  // This exact native connector implements require without plaintext fallback,
  // and strict enables system certificate trust and hostname verification.
  const version=Prisma.prismaVersion;
  requireGate(version.client === '6.14.0' && 'engine' in version
    && version.engine === '717184b7b35ea05dfa71a3236b7af656013e1e49');
  requireGate(!process.env.PRISMA_QUERY_ENGINE_LIBRARY
    && !process.env.PRISMA_QUERY_ENGINE_BINARY && !process.env.PRISMA_CLIENT_ENGINE_TYPE);
  url.searchParams.set('sslaccept', 'strict');
  return url.href;
}
