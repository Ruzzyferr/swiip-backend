import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { hashSessionToken } from "../lib/session.js";
import { UnauthorizedError } from "../lib/httpErrors.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
      session?: { id: string };
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing or invalid authorization header");
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    const tokenHash = hashSessionToken(token);

    // Find session by token hash
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedError("Invalid session token");
    }

    // Check if session is expired
    if (session.expiresAt < new Date()) {
      // Delete expired session
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {
        // Ignore errors during cleanup
      });
      throw new UnauthorizedError("Session expired");
    }

    // Check if user is banned
    if (session.user.isBanned) {
      throw new UnauthorizedError("User account is banned");
    }

    // Attach user and session to request
    req.user = { id: session.userId };
    req.session = { id: session.id };

    next();
  } catch (error) {
    next(error);
  }
}

