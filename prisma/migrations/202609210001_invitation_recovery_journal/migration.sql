CREATE TYPE "InvitationRecoveryPhase" AS ENUM ('CLAIMED', 'OLD_REVOCATION_PENDING', 'OLD_REVOKED', 'REPLACEMENT_CREATE_PENDING', 'REPLACEMENT_IDENTIFIED', 'LOCAL_RECONCILIATION_PENDING', 'COMPLETED');
CREATE TYPE "InvitationRecoveryStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'COMPLETED');
CREATE TYPE "InvitationRecoveryFailure" AS ENUM ('PRECONDITION_FAILED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_STATE_AMBIGUOUS', 'REVOCATION_UNCONFIRMED', 'CREATION_UNCONFIRMED', 'LOCAL_PERSISTENCE_FAILED');

CREATE TABLE "invitation_recoveries" (
  "id" UUID NOT NULL,
  "student_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "invitation_id" UUID NOT NULL,
  "old_provider_invitation_id" TEXT NOT NULL,
  "replacement_provider_invitation_id" TEXT,
  "phase" "InvitationRecoveryPhase" NOT NULL DEFAULT 'CLAIMED',
  "status" "InvitationRecoveryStatus" NOT NULL DEFAULT 'ACTIVE',
  "failure" "InvitationRecoveryFailure",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "invitation_recoveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invitation_recoveries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "runtime_students"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "invitation_recoveries_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "preview_invitations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "invitation_recoveries_completion_check" CHECK (
    ("status" = 'COMPLETED') = ("phase" = 'COMPLETED') AND
    ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL) AND
    ("status" <> 'COMPLETED' OR ("replacement_provider_invitation_id" IS NOT NULL AND "failure" IS NULL))
  ),
  CONSTRAINT "invitation_recoveries_distinct_provider_ids" CHECK ("replacement_provider_invitation_id" IS DISTINCT FROM "old_provider_invitation_id")
);
CREATE UNIQUE INDEX "invitation_recoveries_provider_old_provider_invitation_id_key" ON "invitation_recoveries"("provider", "old_provider_invitation_id");
CREATE UNIQUE INDEX "invitation_recoveries_replacement_provider_invitation_id_key" ON "invitation_recoveries"("replacement_provider_invitation_id");
CREATE UNIQUE INDEX "invitation_recoveries_one_unresolved_key" ON "invitation_recoveries"("invitation_id") WHERE "status" <> 'COMPLETED';
CREATE INDEX "invitation_recoveries_student_id_status_idx" ON "invitation_recoveries"("student_id", "status");

-- Journal identity and completed history cannot be rewritten or deleted.
CREATE FUNCTION protect_invitation_recovery_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Recovery history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM preview_invitations i WHERE i.id = NEW.invitation_id AND i.student_id = NEW.student_id AND i.email = NEW.email AND i.provider = NEW.provider AND i.provider_invitation_id = NEW.old_provider_invitation_id) THEN
      RAISE EXCEPTION 'Recovery identity does not match invitation';
    END IF;
  ELSE
    IF OLD.status = 'COMPLETED' OR
       ROW(NEW.id, NEW.student_id, NEW.email, NEW.provider, NEW.invitation_id, NEW.old_provider_invitation_id, NEW.created_at) IS DISTINCT FROM
       ROW(OLD.id, OLD.student_id, OLD.email, OLD.provider, OLD.invitation_id, OLD.old_provider_invitation_id, OLD.created_at) OR
       (OLD.replacement_provider_invitation_id IS NOT NULL AND NEW.replacement_provider_invitation_id IS DISTINCT FROM OLD.replacement_provider_invitation_id) THEN
      RAISE EXCEPTION 'Recovery history is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invitation_recovery_history_guard BEFORE INSERT OR UPDATE OR DELETE ON "invitation_recoveries" FOR EACH ROW EXECUTE FUNCTION protect_invitation_recovery_history();
