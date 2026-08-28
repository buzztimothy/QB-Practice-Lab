CREATE TABLE "runtime_students" (
  "id" TEXT PRIMARY KEY,
  "display_name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "runtime_attempts" (
  "id" TEXT PRIMARY KEY,
  "student_id" TEXT NOT NULL REFERENCES "runtime_students"("id") ON DELETE RESTRICT,
  "lab_version" TEXT NOT NULL,
  "generation" INTEGER NOT NULL CHECK ("generation" > 0),
  "status" TEXT NOT NULL CHECK ("status" IN ('ACTIVE','COMPLETED','RESET')),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "persistence_version" INTEGER NOT NULL DEFAULT 0 CHECK ("persistence_version" >= 0),
  "accounting_state" JSONB NOT NULL,
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

CREATE FUNCTION reject_canonical_bootstrap_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'canonical bootstrap records are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER canonical_lab_bootstrap_immutable
  BEFORE UPDATE OR DELETE ON "canonical_lab_bootstrap"
  FOR EACH ROW EXECUTE FUNCTION reject_canonical_bootstrap_mutation();
