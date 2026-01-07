import dotenv from "dotenv";
import { createApp } from "./app.js";
import { getEnv } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { runDataMigrations } from "./lib/migrations.js";

dotenv.config();

const env = getEnv();
const app = createApp();

// Run data migrations before starting server
async function start() {
  try {
    // Run data migrations (safe to run multiple times)
    await runDataMigrations();
    
    app.listen(env.PORT, () => {
      logger.info(`[swiip-backend] Server listening on http://localhost:${env.PORT}`, {
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
      });
    });
  } catch (error) {
    logger.error("[swiip-backend] Failed to start server", { error: String(error) });
    process.exit(1);
  }
}

start();
