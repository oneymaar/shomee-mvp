-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "llmFilledFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
