CREATE TABLE "runtime_students" (
  "id" TEXT PRIMARY KEY,
  "display_name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "runtime_attempts" (
  "id" TEXT PRIMARY KEY,
  "student_id" TEXT NOT NULL REFERENCES "runtime_students"("id") ON DELETE RESTRICT,
  "ledger_attempt_id" UUID NOT NULL UNIQUE REFERENCES "student_attempts"("id") ON DELETE RESTRICT,
  "lab_version" TEXT NOT NULL,
  "generation" INTEGER NOT NULL CHECK ("generation" > 0),
  "status" TEXT NOT NULL CHECK ("status" IN ('ACTIVE','COMPLETED','RESET')),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "persistence_version" INTEGER NOT NULL DEFAULT 0 CHECK ("persistence_version" >= 0),
  "accounting_digest" TEXT NOT NULL,
  "p002_metadata_state" JSONB NOT NULL,
  "evidence_state" JSONB NOT NULL,
  "interaction_state" JSONB NOT NULL,
  "coaching_state" JSONB NOT NULL,
  "assessment_state" JSONB,
  "meeting_state" JSONB,
  "report_state" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runtime_attempts_student_lab_generation_key" UNIQUE ("student_id", "lab_version", "generation")
);
CREATE INDEX "runtime_attempts_student_status_generation_idx" ON "runtime_attempts"("student_id", "status", "generation");

ALTER TABLE "template_customers" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "template_accounts" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "template_documents" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "attempt_customers" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "attempt_accounts" ALTER COLUMN "source_template_account_id" DROP NOT NULL;
ALTER TABLE "attempt_accounts" ADD COLUMN "runtime_key" TEXT;
CREATE OR REPLACE FUNCTION assert_attempt_account_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_template_account_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM student_attempts attempt
    JOIN template_accounts source ON source.id=NEW.source_template_account_id
    WHERE attempt.id=NEW.attempt_id AND attempt.template_id=source.template_id
  ) THEN
    RAISE EXCEPTION 'account source is outside the attempt template';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE "journal_entries" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "journal_entries" ADD COLUMN "runtime_source_id" TEXT;
ALTER TABLE "journal_lines" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "invoices" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "invoice_lines" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "customer_payments" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "payment_applications" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "bank_deposits" ADD COLUMN "runtime_key" TEXT;
ALTER TABLE "reconciliations" ADD COLUMN "runtime_key" TEXT;
CREATE UNIQUE INDEX "template_customers_template_runtime_key" ON "template_customers"("template_id","runtime_key");
CREATE UNIQUE INDEX "template_accounts_template_runtime_key" ON "template_accounts"("template_id","runtime_key");
CREATE UNIQUE INDEX "template_documents_template_runtime_key" ON "template_documents"("template_id","runtime_key");
CREATE UNIQUE INDEX "attempt_customers_attempt_runtime_key" ON "attempt_customers"("attempt_id","runtime_key");
CREATE UNIQUE INDEX "attempt_accounts_attempt_runtime_key" ON "attempt_accounts"("attempt_id","runtime_key");
CREATE UNIQUE INDEX "journal_entries_attempt_runtime_key" ON "journal_entries"("attempt_id","runtime_key");
CREATE UNIQUE INDEX "journal_lines_attempt_runtime_key" ON "journal_lines"("attempt_id","runtime_key");
CREATE UNIQUE INDEX "invoices_attempt_runtime_key" ON "invoices"("attempt_id","runtime_key");
CREATE UNIQUE INDEX "invoice_lines_attempt_runtime_key" ON "invoice_lines"("attempt_id","runtime_key");
CREATE UNIQUE INDEX "customer_payments_attempt_runtime_key" ON "customer_payments"("attempt_id","runtime_key");
CREATE UNIQUE INDEX "payment_applications_attempt_runtime_key" ON "payment_applications"("attempt_id","runtime_key");
CREATE UNIQUE INDEX "bank_deposits_attempt_runtime_key" ON "bank_deposits"("attempt_id","runtime_key");
CREATE UNIQUE INDEX "reconciliations_attempt_runtime_key" ON "reconciliations"("attempt_id","runtime_key");

CREATE TABLE "runtime_historical_reconciliation_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "attempt_id" UUID NOT NULL,
  "reconciliation_id" UUID NOT NULL,
  "runtime_line_key" TEXT NOT NULL,
  "attempt_account_id" UUID NOT NULL,
  "debit_cents" BIGINT NOT NULL DEFAULT 0,
  "credit_cents" BIGINT NOT NULL DEFAULT 0,
  "fingerprint" TEXT NOT NULL,
  UNIQUE ("attempt_id", "reconciliation_id", "runtime_line_key"),
  FOREIGN KEY ("attempt_id", "reconciliation_id") REFERENCES "reconciliations"("attempt_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("attempt_id", "attempt_account_id") REFERENCES "attempt_accounts"("attempt_id", "id") ON DELETE RESTRICT,
  CHECK (("debit_cents" > 0 AND "credit_cents" = 0) OR ("credit_cents" > 0 AND "debit_cents" = 0))
);

CREATE OR REPLACE FUNCTION assert_reconciliation_completed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE movement BIGINT; mismatches BIGINT; kind "AccountKind";
BEGIN
  IF NEW.status='COMPLETED' THEN
    SELECT a.kind INTO kind FROM attempt_accounts a WHERE a.id=NEW.account_id AND a.attempt_id=NEW.attempt_id;
    SELECT COALESCE(SUM(value),0), COALESCE(SUM(mismatch),0) INTO movement,mismatches FROM (
      SELECT CASE WHEN kind='LIABILITY' THEN l.credit_cents-l.debit_cents ELSE l.debit_cents-l.credit_cents END AS value,
             CASE WHEN rl.fingerprint=(l.debit_cents||':'||l.credit_cents||':'||l.attempt_account_id) THEN 0 ELSE 1 END AS mismatch
      FROM reconciliation_lines rl JOIN journal_lines l ON l.id=rl.journal_line_id
      WHERE rl.attempt_id=NEW.attempt_id AND rl.reconciliation_id=NEW.id
      UNION ALL
      SELECT CASE WHEN kind='LIABILITY' THEN h.credit_cents-h.debit_cents ELSE h.debit_cents-h.credit_cents END, 0
      FROM runtime_historical_reconciliation_lines h
      WHERE h.attempt_id=NEW.attempt_id AND h.reconciliation_id=NEW.id AND h.attempt_account_id=NEW.account_id
    ) accepted_lines;
    IF mismatches<>0 OR NEW.beginning_balance_cents+movement<>NEW.ending_balance_cents THEN
      RAISE EXCEPTION 'reconciliation is not balanced';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE "runtime_audit_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "attempt_id" TEXT NOT NULL REFERENCES "runtime_attempts"("id") ON DELETE RESTRICT,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("attempt_id", "sequence")
);
CREATE INDEX "runtime_audit_events_attempt_sequence_idx" ON "runtime_audit_events"("attempt_id","sequence");

CREATE TABLE "external_identity_links" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id" TEXT NOT NULL REFERENCES "runtime_students"("id") ON DELETE RESTRICT,
  "provider" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "email" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_identity_links_provider_subject_key" UNIQUE ("provider", "subject"),
  CONSTRAINT "external_identity_links_provider_email_key" UNIQUE ("provider", "email")
);
CREATE INDEX "external_identity_links_student_active_idx" ON "external_identity_links"("student_id", "active");

CREATE TABLE "runtime_idempotency" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "attempt_id" TEXT NOT NULL REFERENCES "runtime_attempts"("id") ON DELETE CASCADE,
  "idempotency_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "command_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runtime_idempotency_attempt_key_key" UNIQUE ("attempt_id", "idempotency_key")
);
CREATE INDEX "runtime_idempotency_attempt_revision_idx" ON "runtime_idempotency"("attempt_id", "revision");

CREATE TABLE "runtime_snapshots" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "attempt_id" TEXT NOT NULL REFERENCES "runtime_attempts"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "payload" JSONB NOT NULL,
  "content_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runtime_snapshots_attempt_kind_sequence_key" UNIQUE ("attempt_id", "kind", "sequence"),
  CONSTRAINT "runtime_snapshots_attempt_kind_hash_key" UNIQUE ("attempt_id", "kind", "content_hash")
);
CREATE INDEX "runtime_snapshots_attempt_kind_sequence_idx" ON "runtime_snapshots"("attempt_id", "kind", "sequence");

CREATE TABLE "student_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "token_hash" TEXT NOT NULL UNIQUE,
  "student_id" TEXT NOT NULL REFERENCES "runtime_students"("id") ON DELETE RESTRICT,
  "subject" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "student_sessions_student_expires_idx" ON "student_sessions"("student_id", "expires_at");
CREATE INDEX "student_sessions_expires_revoked_idx" ON "student_sessions"("expires_at", "revoked_at");

CREATE TABLE "canonical_lab_bootstrap" (
  "lab_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "content_manifest" JSONB NOT NULL,
  "database_digest" TEXT NOT NULL,
  "installed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("lab_id", "version")
);

CREATE FUNCTION reject_runtime_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'runtime snapshots are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER runtime_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "runtime_snapshots"
  FOR EACH ROW EXECUTE FUNCTION reject_runtime_snapshot_mutation();

CREATE TRIGGER runtime_audit_events_immutable
  BEFORE UPDATE OR DELETE ON "runtime_audit_events"
  FOR EACH ROW EXECUTE FUNCTION reject_runtime_snapshot_mutation();

CREATE FUNCTION reject_completed_reconciliation_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed reconciliations are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER completed_reconciliations_immutable
  BEFORE UPDATE OR DELETE ON "reconciliations"
  FOR EACH ROW EXECUTE FUNCTION reject_completed_reconciliation_mutation();

CREATE FUNCTION reject_completed_reconciliation_line_mutation() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "reconciliations"
    WHERE "id" = OLD."reconciliation_id"
      AND "attempt_id" = OLD."attempt_id"
      AND "status" = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'completed reconciliation lines are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER completed_reconciliation_lines_immutable
  BEFORE UPDATE OR DELETE ON "reconciliation_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_completed_reconciliation_line_mutation();

CREATE TRIGGER completed_historical_reconciliation_lines_immutable
  BEFORE UPDATE OR DELETE ON "runtime_historical_reconciliation_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_completed_reconciliation_line_mutation();

CREATE FUNCTION reject_canonical_bootstrap_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'canonical bootstrap records are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER canonical_lab_bootstrap_immutable
  BEFORE UPDATE OR DELETE ON "canonical_lab_bootstrap"
  FOR EACH ROW EXECUTE FUNCTION reject_canonical_bootstrap_mutation();
