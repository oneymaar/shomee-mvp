-- P0 — Partage de bien : page publique /p/<token>.
--
-- Migration STRICTEMENT ADDITIVE : deux colonnes nullable/à défaut sur
-- "Property", une table neuve. Aucune colonne existante n'est altérée,
-- renommée ou supprimée.
--
-- Écrite à la main et rendue IDEMPOTENTE à dessein : la base de ce projet est
-- tenue à jour par `prisma db push` (cf. MAJ_SHOMEE.command), qui aura donc
-- déjà créé ces objets. Ce fichier existe pour l'historique et pour tout
-- environnement piloté par `prisma migrate deploy` — il doit pouvoir passer
-- dans les deux cas sans jamais échouer.

-- AlterTable
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "isShareable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: ShareView — une ligne par rendu serveur de /p/<token>.
-- "isBot" marque les crawlers d'aperçu (WhatsApp, Facebook, Slack…) pour
-- qu'ils ne gonflent pas les vues réelles.
CREATE TABLE IF NOT EXISTS "ShareView" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "ref" TEXT,
    "userAgent" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Property_shareToken_key" ON "Property"("shareToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShareView_propertyId_createdAt_idx" ON "ShareView"("propertyId", "createdAt");

-- AddForeignKey (Postgres n'a pas d'IF NOT EXISTS sur les contraintes)
DO $$ BEGIN
  ALTER TABLE "ShareView" ADD CONSTRAINT "ShareView_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
