import { PrismaClient } from '@prisma/client';
import { previewDatabaseName, previewDeployRole } from './database-target-guard.js';
import { strictPreviewDatabaseUrl } from './strict-preview-connection.js';

// Only numeric classifications cross the credentialed process boundary.
export const tlsPreflightExit = Object.freeze({
  pass: 0, target: 10, connection: 11, query: 12,
  identity: 13, unavailable: 15, internal: 16,
});

interface DiagnosticClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRaw(query: TemplateStringsArray, database: string, role: string): Promise<{
    databaseMatches: boolean; roleMatches: boolean;
  }[]>;
}

export async function diagnosePreviewTls(
  env: NodeJS.ProcessEnv,
  createClient: (url: string) => DiagnosticClient = url => new PrismaClient({datasources:{db:{url}}}),
): Promise<number> {
  let url:string;
  try { url=strictPreviewDatabaseUrl(env.DIRECT_DATABASE_URL??'',env.PREVIEW_DATABASE_HOST); }
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
             current_user = ${previewDeployRole} AS "roleMatches"
    `;
    if(rows.length!==1) result=tlsPreflightExit.unavailable;
    else if(rows[0].databaseMatches!==true || rows[0].roleMatches!==true) result=tlsPreflightExit.identity;
    else result=tlsPreflightExit.pass;
  } catch {
    // Preserve the stage without serializing provider errors.
  } finally {
    try { await db.$disconnect(); }
    catch { result=tlsPreflightExit.internal; }
  }
  return result;
}
