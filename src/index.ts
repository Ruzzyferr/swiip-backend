import dotenv from "dotenv";
import { createApp } from "./app.js";
import { getEnv } from "./lib/env.js";
import { logger } from "./lib/logger.js";

dotenv.config();

const env = getEnv();
const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`[swiip-backend] Server listening on http://localhost:${env.PORT}`, {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
  });
});
