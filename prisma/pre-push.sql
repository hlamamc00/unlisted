-- Runs before `prisma db push` in production builds (see netlify.toml).
--
-- Adding a unique column to a table that already has rows makes `prisma db push`
-- stop with a data-loss warning, even when the column is new and empty, so no
-- duplicates are possible. Creating those columns and their unique indexes here
-- first (with the names Prisma uses) leaves db push nothing to warn about.
-- Everything is "IF NOT EXISTS", so this is safe to run on every build, and it
-- does nothing on a new, empty database (db push then creates everything).
-- When a later schema change adds a unique column to an existing table, add it here too.

DO $$
BEGIN
  IF to_regclass('"Person"') IS NOT NULL THEN
    ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "linkedinUrl" TEXT;
    ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "pdlId" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "Person_linkedinUrl_key" ON "Person"("linkedinUrl");
    CREATE UNIQUE INDEX IF NOT EXISTS "Person_pdlId_key" ON "Person"("pdlId");
  END IF;
  IF to_regclass('"Role"') IS NOT NULL THEN
    ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "Role_shareToken_key" ON "Role"("shareToken");
  END IF;
  IF to_regclass('"OptOut"') IS NOT NULL THEN
    ALTER TABLE "OptOut" ADD COLUMN IF NOT EXISTS "linkedinUrl" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "OptOut_linkedinUrl_key" ON "OptOut"("linkedinUrl");
  END IF;
END $$;
