/*
  Warnings:

  - A unique constraint covering the columns `[requestId]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('LIKE', 'FAVORITE');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "requestId" TEXT,
ALTER COLUMN "matchId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isRequestMessage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requestId" TEXT,
ALTER COLUMN "conversationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyDirectUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastDirectResetAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ConversationRequest" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "kind" "RequestKind" NOT NULL,
    "firstMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationRequest_firstMessageId_key" ON "ConversationRequest"("firstMessageId");

-- CreateIndex
CREATE INDEX "ConversationRequest_fromUserId_status_idx" ON "ConversationRequest"("fromUserId", "status");

-- CreateIndex
CREATE INDEX "ConversationRequest_toUserId_status_idx" ON "ConversationRequest"("toUserId", "status");

-- CreateIndex
CREATE INDEX "ConversationRequest_status_idx" ON "ConversationRequest"("status");

-- CreateIndex
CREATE INDEX "ConversationRequest_kind_idx" ON "ConversationRequest"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationRequest_fromUserId_toUserId_key" ON "ConversationRequest"("fromUserId", "toUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_requestId_key" ON "Conversation"("requestId");

-- CreateIndex
CREATE INDEX "Conversation_requestId_idx" ON "Conversation"("requestId");

-- CreateIndex
CREATE INDEX "Message_requestId_idx" ON "Message"("requestId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConversationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConversationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRequest" ADD CONSTRAINT "ConversationRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRequest" ADD CONSTRAINT "ConversationRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRequest" ADD CONSTRAINT "ConversationRequest_firstMessageId_fkey" FOREIGN KEY ("firstMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
