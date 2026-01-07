import { prisma } from "./prisma.js";

/**
 * Run data migrations that need to happen after schema migrations.
 * These are safe to run multiple times (idempotent).
 */
export async function runDataMigrations(): Promise<void> {
  console.log("[Migrations] Running data migrations...");

  try {
    // Migration 1: Ensure all messages have isRead field set
    const result = await prisma.$executeRaw`
      UPDATE "Message" 
      SET "isRead" = false 
      WHERE "isRead" IS NULL
    `;
    
    if (result > 0) {
      console.log(`[Migrations] Updated ${result} messages with isRead = false`);
    }

    console.log("[Migrations] Data migrations completed successfully");
  } catch (error) {
    console.error("[Migrations] Data migration error:", error);
    // Don't throw - allow server to start even if migration fails
  }
}
