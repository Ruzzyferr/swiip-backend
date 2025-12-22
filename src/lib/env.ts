import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // AI Configuration
  AI_PROVIDER: z.enum(["openai", "openrouter"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_DAILY_FREE_LIMIT: z.coerce.number().int().positive().default(10),
  MSG_DAILY_FREE_LIMIT: z.coerce.number().int().positive().default(30),
  LIKE_DAILY_FREE_LIMIT: z.coerce.number().int().positive().default(15),
  LIKE_REWARD_AMOUNT: z.coerce.number().int().positive().default(3),
  LIKE_MAX_REWARDS_PER_DAY: z.coerce.number().int().positive().default(5),
  ADMIN_KEY: z.string().optional(),
  // RevenueCat Webhook
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
}).refine((data) => {
  // Only enforce API key in production
  if (data.NODE_ENV === "production") {
    if (data.AI_PROVIDER === "openai" && !data.OPENAI_API_KEY) {
      return false;
    }
    if (data.AI_PROVIDER === "openrouter" && !data.OPENROUTER_API_KEY) {
      return false;
    }
    // Require webhook secret in production
    if (!data.REVENUECAT_WEBHOOK_SECRET) {
      return false;
    }
  }
  return true;
}, {
  message: "API key is required for the selected AI provider in production, and REVENUECAT_WEBHOOK_SECRET is required in production",
});

export type Env = z.infer<typeof envSchema>;

let env: Env;

export function getEnv(): Env {
  if (!env) {
    env = envSchema.parse(process.env);
  }
  return env;
}

