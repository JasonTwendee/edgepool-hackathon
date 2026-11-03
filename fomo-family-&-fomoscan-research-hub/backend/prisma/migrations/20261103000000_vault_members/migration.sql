-- KOL-pool deposit allowlist. Partner pools are invite-only; basket pools
-- ignore this table. The pool owner is backfilled as the first member.
CREATE TABLE "vault_members" (
    "id" SERIAL NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "added_by_user_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vault_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vault_members_vault_id_user_id_key" ON "vault_members"("vault_id", "user_id");
CREATE INDEX "vault_members_user_id_idx" ON "vault_members"("user_id");

ALTER TABLE "vault_members"
    ADD CONSTRAINT "vault_members_vault_id_fkey"
    FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vault_members"
    ADD CONSTRAINT "vault_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Owner KOLs always keep deposit access to their own partner pool.
INSERT INTO "vault_members" ("vault_id", "user_id", "added_by_user_id")
SELECT v."id", v."owner_user_id", NULL
FROM "vaults" v
WHERE v."owner_user_id" IS NOT NULL
  AND v."kind" = 'partner'
ON CONFLICT ("vault_id", "user_id") DO NOTHING;
