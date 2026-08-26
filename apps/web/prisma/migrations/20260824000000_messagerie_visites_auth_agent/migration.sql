-- Messagerie persistée + visites + connexion agent (23/08/2026).
-- Migration ÉCRITE À LA MAIN (session sans accès réseau : prisma migrate diff
-- indisponible) — additive uniquement, aucune donnée existante touchée.

-- AlterTable: Agent — mot de passe (nullable : compte créé par l'admin, activé
-- par l'agent via son lien) + jeton d'activation.
ALTER TABLE "Agent" ADD COLUMN     "passwordHash" TEXT;
ALTER TABLE "Agent" ADD COLUMN     "setupToken" TEXT;
ALTER TABLE "Agent" ADD COLUMN     "setupTokenExpires" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('BUYER', 'AGENT');
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'VISIT_REQUEST', 'AVAILABILITIES', 'VISIT_CONFIRMED', 'SYSTEM');
CREATE TYPE "VisitStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateTable: une conversation par (acquéreur, bien).
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buyerLastReadAt" TIMESTAMP(3),
    "agentLastReadAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "MessageSender" NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
    "text" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "status" "VisitStatus" NOT NULL DEFAULT 'CONFIRMED',
    "icsToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_setupToken_key" ON "Agent"("setupToken");
CREATE UNIQUE INDEX "Conversation_buyerUserId_propertyId_key" ON "Conversation"("buyerUserId", "propertyId");
CREATE INDEX "Conversation_agentId_lastMessageAt_idx" ON "Conversation"("agentId", "lastMessageAt");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE UNIQUE INDEX "Visit_icsToken_key" ON "Visit"("icsToken");
CREATE INDEX "Visit_agentId_scheduledAt_idx" ON "Visit"("agentId", "scheduledAt");
CREATE INDEX "Visit_buyerUserId_scheduledAt_idx" ON "Visit"("buyerUserId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
