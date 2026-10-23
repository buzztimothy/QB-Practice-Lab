-- Durable operator coordination. An abandoned HELD row has no automatic expiry.
-- Install under separate rollout authorization before enabling the corrected operators.
CREATE TABLE "preview_release_fence" (
  "id" TEXT PRIMARY KEY CHECK ("id" = 'preview'),
  "held" BOOLEAN NOT NULL DEFAULT false,
  "owner" UUID,
  "operation" TEXT CHECK ("operation" IN ('recovery', 'deployment')),
  "acquired_at" TIMESTAMPTZ,
  "released_at" TIMESTAMPTZ,
  CHECK (NOT "held" OR ("owner" IS NOT NULL AND "operation" IS NOT NULL AND "acquired_at" IS NOT NULL))
);
INSERT INTO "preview_release_fence" ("id") VALUES ('preview');
