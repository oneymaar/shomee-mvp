-- CreateTable
CREATE TABLE "BuyerBriefToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "briefJson" JSONB NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerBriefToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuyerBriefToken_token_key" ON "BuyerBriefToken"("token");

-- CreateIndex
CREATE INDEX "BuyerBriefToken_token_idx" ON "BuyerBriefToken"("token");

-- CreateIndex
CREATE INDEX "BuyerBriefToken_expiresAt_idx" ON "BuyerBriefToken"("expiresAt");
