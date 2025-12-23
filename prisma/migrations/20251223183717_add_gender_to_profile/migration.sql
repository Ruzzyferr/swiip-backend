-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "gender" "Gender";

-- CreateIndex
CREATE INDEX "Profile_gender_idx" ON "Profile"("gender");
