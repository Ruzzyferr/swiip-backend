import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import healthRoutes from "./routes/health.js";
import v1Routes from "./routes/v1/index.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { rateLimiterMiddleware } from "./middleware/rateLimiter.js";
import { HttpError } from "./lib/httpErrors.js";
import { logger } from "./lib/logger.js";

export function createApp(): Express {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));

  // Body parsing
  app.use(express.json({ limit: "1mb" }));

  // Request ID middleware (must be early)
  app.use(requestIdMiddleware);

  // Logging
  app.use(morgan("dev"));

  // Rate limiting
  app.use(rateLimiterMiddleware);

  // Health check (root level)
  app.use("/health", healthRoutes);

  // API v1 routes
  app.use("/api/v1", v1Routes);

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.id || "unknown";
    
    if (err instanceof HttpError) {
      logger.warn("HTTP error", {
        requestId,
        statusCode: err.statusCode,
        message: err.message,
        code: err.code,
      });
      
      return res.status(err.statusCode).json({
        error: {
          code: err.code || "HTTP_ERROR",
          message: err.message,
          requestId,
        },
      });
    }

    // Zod validation errors
    if (err.name === "ZodError") {
      const zodError = err as unknown as { errors: Array<{ message: string; path: (string | number)[] }> };
      const firstError = zodError.errors[0];
      const field = firstError.path.join(".");
      logger.warn("Validation error", {
        requestId,
        field,
        message: firstError.message,
      });
      
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: firstError.message,
          requestId,
        },
      });
    }

    // Unexpected errors
    logger.error("Unexpected error", {
      requestId,
      message: err.message,
      stack: err.stack,
    });

    res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
        requestId,
      },
    });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: req.id || "unknown",
      },
    });
  });

  return app;
}

