import dotenv from "dotenv";
import http from "http";
import { createApp } from "./app.js";
import { getEnv } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { runDataMigrations } from "./lib/migrations.js";
import { initSocketServer } from "./lib/socket.js";

dotenv.config();

const env = getEnv();
const app = createApp();

// Create HTTP server to share with Socket.IO
const httpServer = http.createServer(app);

// Initialize Socket.IO
initSocketServer(httpServer);

// Run data migrations before starting server
async function start() {
  try {
    // Run data migrations (safe to run multiple times)
    await runDataMigrations();

    httpServer.listen(env.PORT, () => {
      logger.info(`[conversa-backend] Server listening on http://localhost:${env.PORT}`, {
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
        websocket: true,
      });
    });
  } catch (error) {
    logger.error("[conversa-backend] Failed to start server", { error: String(error) });
    process.exit(1);
  }
}

start();
