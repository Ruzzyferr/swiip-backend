-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentBoostEndsAt" TIMESTAMP(3),
ADD COLUMN     "lastBoostResetAt" TIMESTAMP(3),
ADD COLUMN     "lastFavoriteResetAt" TIMESTAMP(3),
ADD COLUMN     "purchasedBoosts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "purchasedFavorites" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weeklyBoostsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weeklyFavoriteAdUsedAt" TIMESTAMP(3),
ADD COLUMN     "weeklyFavoritesUsed" INTEGER NOT NULL DEFAULT 0;
