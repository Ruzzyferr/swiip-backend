import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      ok: true,
      name: "swiip-backend",
      timestamp: new Date().toISOString(),
      database: "connected"
    });
  } catch (error) {
    logger.error("Health check failed", { error });
    res.status(503).json({
      ok: false,
      name: "swiip-backend",
      timestamp: new Date().toISOString(),
      database: "disconnected",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

export default router;

