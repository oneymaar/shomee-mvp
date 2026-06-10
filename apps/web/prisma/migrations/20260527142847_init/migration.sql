-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BUYER', 'AGENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "AgencyPlan" AS ENUM ('BASIC', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "MandatType" AS ENUM ('EXCLUSIF', 'SIMPLE', 'COEXCLUSIF');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DpeRating" AS ENUM ('A', 'B', 'C', 'D', 'E', 'F', 'G');

-- CreateEnum
CREATE TYPE "PropertyBadge" AS ENUM ('AVANT_PREMIERE', 'EXCLUSIVITE');

-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('AI_VIDEO', 'AI_DOC', 'AGENT_MANUAL');

-- CreateEnum
CREATE TYPE "VideoAnalysisStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PLAN', 'PV_AG', 'DIAGNOSTIC', 'AUTRE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'BUYER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parsedCriteria" JSONB NOT NULL DEFAULT '[]',
    "rawTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "searchPreferences" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "plan" "AgencyPlan" NOT NULL DEFAULT 'BASIC',
    "maxProperties" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatar" TEXT,
    "agencyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "arrondissement" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentAvatar" TEXT,
    "title" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "pricePerSqm" INTEGER,
    "surface" DOUBLE PRECISION NOT NULL,
    "rooms" INTEGER NOT NULL,
    "bedrooms" INTEGER,
    "location" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dpe" "DpeRating" NOT NULL,
    "ges" "DpeRating",
    "floor" INTEGER,
    "totalFloors" INTEGER,
    "orientation" TEXT,
    "exteriorType" TEXT,
    "heatingType" TEXT,
    "hotWaterType" TEXT,
    "yearBuilt" INTEGER,
    "lotCount" INTEGER,
    "proceduresEnCours" BOOLEAN,
    "monthlyCharges" INTEGER,
    "propertyTax" INTEGER,
    "composition" JSONB,
    "irisZone" TEXT,
    "irisDescription" TEXT,
    "irisPolygon" JSONB,
    "mapLat" DOUBLE PRECISION,
    "mapLng" DOUBLE PRECISION,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nearbyPlaces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "neighborhoodVibe" TEXT,
    "mapTransports" JSONB,
    "mapPois" JSONB,
    "marketAvgPricePerSqm" INTEGER,
    "marketEvolution10y" TEXT,
    "marketHighPrice" INTEGER,
    "marketLowPrice" INTEGER,
    "videoUrl" TEXT,
    "matterportUrl" TEXT,
    "imageUrlFallback" TEXT NOT NULL,
    "gallery" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chapters" JSONB,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "promising" BOOLEAN NOT NULL DEFAULT false,
    "badges" "PropertyBadge"[] DEFAULT ARRAY[]::"PropertyBadge"[],
    "hasElevator" BOOLEAN NOT NULL DEFAULT false,
    "hasTerrace" BOOLEAN NOT NULL DEFAULT false,
    "terraceSurfaceM2" DOUBLE PRECISION,
    "hasBalcony" BOOLEAN NOT NULL DEFAULT false,
    "balconySurfaceM2" DOUBLE PRECISION,
    "hasGarden" BOOLEAN NOT NULL DEFAULT false,
    "gardenSurfaceM2" DOUBLE PRECISION,
    "hasCellar" BOOLEAN NOT NULL DEFAULT false,
    "hasParking" BOOLEAN NOT NULL DEFAULT false,
    "hasConcierge" BOOLEAN NOT NULL DEFAULT false,
    "isGroundFloor" BOOLEAN NOT NULL DEFAULT false,
    "bedroomStreetSide" BOOLEAN,
    "isQuietStreet" BOOLEAN,
    "orientationStructured" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "luminosity" DOUBLE PRECISION,
    "quietness" DOUBLE PRECISION,
    "charm" DOUBLE PRECISION,
    "spaciousness" DOUBLE PRECISION,
    "livingQuality" DOUBLE PRECISION,
    "outdoorUsability" DOUBLE PRECISION,
    "mandatType" "MandatType" NOT NULL DEFAULT 'SIMPLE',
    "avantPremiere" BOOLEAN NOT NULL DEFAULT false,
    "refInterneAgence" TEXT,
    "statut" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "completionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "collaborateurIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agencyId" TEXT NOT NULL,
    "createdByAgentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyTag" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source" "TagSource" NOT NULL,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "criterionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAnalysis" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "VideoAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "chapitres" JSONB,
    "extractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "nom" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerProfile_userId_key" ON "BuyerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_email_key" ON "Agent"("email");

-- CreateIndex
CREATE INDEX "Agent_agencyId_idx" ON "Agent"("agencyId");

-- CreateIndex
CREATE INDEX "Property_agencyId_idx" ON "Property"("agencyId");

-- CreateIndex
CREATE INDEX "Property_createdByAgentId_idx" ON "Property"("createdByAgentId");

-- CreateIndex
CREATE INDEX "Property_statut_idx" ON "Property"("statut");

-- CreateIndex
CREATE INDEX "Property_avantPremiere_idx" ON "Property"("avantPremiere");

-- CreateIndex
CREATE INDEX "PropertyTag_propertyId_idx" ON "PropertyTag"("propertyId");

-- CreateIndex
CREATE INDEX "PropertyTag_category_idx" ON "PropertyTag"("category");

-- CreateIndex
CREATE UNIQUE INDEX "VideoAnalysis_propertyId_key" ON "VideoAnalysis"("propertyId");

-- CreateIndex
CREATE INDEX "Document_propertyId_idx" ON "Document"("propertyId");

-- AddForeignKey
ALTER TABLE "BuyerProfile" ADD CONSTRAINT "BuyerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_createdByAgentId_fkey" FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyTag" ADD CONSTRAINT "PropertyTag_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalysis" ADD CONSTRAINT "VideoAnalysis_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
