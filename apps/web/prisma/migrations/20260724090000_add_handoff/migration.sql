-- CreateTable: Handoff — pont LLM → app native (S9).
-- Successeur du BuyerBriefToken (conservé) : ajoute code court, statut de
-- claim, kind (first_brief|edit) et rattachement utilisateur.
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'first_brief',
    "source" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "diff" JSONB,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Handoff_token_key" ON "Handoff"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Handoff_shortCode_key" ON "Handoff"("shortCode");

-- CreateIndex
CREATE INDEX "Handoff_expiresAt_idx" ON "Handoff"("expiresAt");
