-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "country" TEXT,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Profile_lat_lng_idx" ON "Profile"("lat", "lng");
