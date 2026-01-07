-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "text" SET DATA TYPE VARCHAR(8000);

-- CreateIndex
CREATE INDEX "Message_isRead_idx" ON "Message"("isRead");
