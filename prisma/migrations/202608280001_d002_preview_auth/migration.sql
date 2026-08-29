CREATE TYPE "RuntimeStudentStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');
CREATE TYPE "PreviewInvitationStatus" AS ENUM ('PENDING', 'SENT', 'CONSUMED', 'REVOKED');

ALTER TABLE "runtime_students"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "status" "RuntimeStudentStatus" NOT NULL DEFAULT 'ACTIVE';
CREATE UNIQUE INDEX "runtime_students_email_key" ON "runtime_students"("email");

CREATE TABLE "preview_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" TEXT NOT NULL REFERENCES "runtime_students"("id") ON DELETE RESTRICT,
  "provider" TEXT NOT NULL DEFAULT 'clerk',
  "email" TEXT NOT NULL,
  "provider_invitation_id" TEXT,
  "status" "PreviewInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "consumed_subject" TEXT,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preview_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "preview_invitations_provider_email_key" UNIQUE ("provider", "email"),
  CONSTRAINT "preview_invitations_provider_invitation_id_key" UNIQUE ("provider_invitation_id")
);
CREATE INDEX "preview_invitations_student_id_status_idx" ON "preview_invitations"("student_id", "status");

CREATE TABLE "provider_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "disabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_webhook_events_provider_provider_event_id_key" UNIQUE ("provider", "provider_event_id")
);
CREATE INDEX "provider_webhook_events_provider_subject_disabled_idx" ON "provider_webhook_events"("provider", "subject", "disabled");

CREATE OR REPLACE FUNCTION prevent_external_identity_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provider <> NEW.provider OR OLD.subject <> NEW.subject OR OLD.student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'external identity ownership is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER external_identity_ownership_immutable
BEFORE UPDATE ON "external_identity_links"
FOR EACH ROW EXECUTE FUNCTION prevent_external_identity_reassignment();
CREATE UNIQUE INDEX "external_identity_links_one_active_student_provider"
ON "external_identity_links"("provider", "student_id") WHERE "active" = true;

CREATE OR REPLACE FUNCTION normalize_preview_identity_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN NEW.email := lower(trim(NEW.email)); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_student_email_normalized BEFORE INSERT OR UPDATE OF email ON "runtime_students" FOR EACH ROW EXECUTE FUNCTION normalize_preview_identity_email();
CREATE TRIGGER identity_link_email_normalized BEFORE INSERT OR UPDATE OF email ON "external_identity_links" FOR EACH ROW EXECUTE FUNCTION normalize_preview_identity_email();
CREATE TRIGGER preview_invitation_email_normalized BEFORE INSERT OR UPDATE OF email ON "preview_invitations" FOR EACH ROW EXECUTE FUNCTION normalize_preview_identity_email();
