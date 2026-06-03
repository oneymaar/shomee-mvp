-- BuyerBriefToken: tokens are now multi-use (valid until expiresAt).
-- Drop the `used` column — replay/refresh is allowed within the TTL.

-- AlterTable
ALTER TABLE "BuyerBriefToken" DROP COLUMN "used";
