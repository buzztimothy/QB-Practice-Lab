import type { Prisma } from '@prisma/client';

const mutableTables=[
  'student_attempts','attempt_customers','attempt_accounts','journal_entries','journal_lines','attempt_actions',
  'invoices','invoice_lines','customer_payments','payment_applications','bank_deposits','bank_deposit_payments',
  'reconciliations','reconciliation_lines','runtime_historical_reconciliation_lines','runtime_students',
  'external_identity_links','runtime_attempts','runtime_audit_events','runtime_idempotency','runtime_snapshots',
  'student_sessions','preview_invitations','provider_webhook_events',
].map(name=>`"${name}"`).join(', ');

export const previewRuntimeGrantStatements=Object.freeze([
  'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
  'REVOKE CREATE ON SCHEMA public FROM bbb_preview_runtime_lp',
  'GRANT USAGE ON SCHEMA public TO bbb_preview_runtime_lp',
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM bbb_preview_runtime_lp',
  'GRANT SELECT ON ALL TABLES IN SCHEMA public TO bbb_preview_runtime_lp',
  `GRANT INSERT, UPDATE, DELETE ON TABLE ${mutableTables} TO bbb_preview_runtime_lp`,
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM bbb_preview_runtime_lp',
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bbb_preview_runtime_lp',
  'ALTER DEFAULT PRIVILEGES FOR ROLE bbb_preview_deploy_lp IN SCHEMA public GRANT SELECT ON TABLES TO bbb_preview_runtime_lp',
  'ALTER DEFAULT PRIVILEGES FOR ROLE bbb_preview_deploy_lp IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bbb_preview_runtime_lp',
]);

export async function applyPreviewRuntimeGrants(prisma:Prisma.TransactionClient){
  for(const statement of previewRuntimeGrantStatements)await prisma.$executeRawUnsafe(statement);
}
