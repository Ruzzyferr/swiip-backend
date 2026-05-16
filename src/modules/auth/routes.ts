import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { generateSessionToken, hashSessionToken, getSessionExpiry } from "../../lib/session.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError } from "../../lib/httpErrors.js";
import { createVerificationCode, verifyCode, sendVerificationCode } from "../../lib/verification.js";
import { generateReferralCode } from "../../lib/referral.js";
import { getEnv } from "../../lib/env.js";

const router = Router();

const registerLoginSchema = z.object({
  email: z.string().email().toLowerCase().trim().optional(),
  phone: z.string().trim().optional(),
}).refine((data) => data.email || data.phone, {
  message: "Either email or phone must be provided",
});

router.post("/register", async (req, res, next) => {
  try {
    const body = registerLoginSchema.parse(req.body);

    // Normalize email and phone (schema already does this, but be explicit)
    const normalizedEmail = body.email ? body.email.toLowerCase().trim() : null;
    const normalizedPhone = body.phone ? body.phone.trim() : null;

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          normalizedEmail ? { email: normalizedEmail } : {},
          normalizedPhone ? { phone: normalizedPhone } : {},
        ].filter((condition) => Object.keys(condition).length > 0),
      },
    });

    if (!user) {
      // Generate unique referral code
      let referralCode = generateReferralCode();
      let codeExists = true;
      while (codeExists) {
        const existing = await prisma.user.findUnique({
          where: { referralCode },
        });
        if (!existing) {
          codeExists = false;
        } else {
          referralCode = generateReferralCode();
        }
      }

      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          phone: normalizedPhone,
          referralCode,
        },
      });
    }

    // Create session
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = getSessionExpiry();

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    res.json({
      userId: user.id,
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      next(new BadRequestError(firstError?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const body = registerLoginSchema.parse(req.body);

    // Normalize email and phone
    const normalizedEmail = body.email ? body.email.toLowerCase().trim() : null;
    const normalizedPhone = body.phone ? body.phone.trim() : null;

    // Find user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          normalizedEmail ? { email: normalizedEmail } : {},
          normalizedPhone ? { phone: normalizedPhone } : {},
        ].filter((condition) => Object.keys(condition).length > 0),
      },
      include: {
        profile: true,
      },
    });

    // If user doesn't exist, create new user
    if (!user) {
      // Generate unique referral code
      let referralCode = generateReferralCode();
      let codeExists = true;
      while (codeExists) {
        const existing = await prisma.user.findUnique({
          where: { referralCode },
        });
        if (!existing) {
          codeExists = false;
        } else {
          referralCode = generateReferralCode();
        }
      }

      const newUser = await prisma.user.create({
        data: {
          email: normalizedEmail,
          phone: normalizedPhone,
          referralCode,
        },
        include: {
          profile: true,
        },
      });
      user = newUser;
    }

    // Always send verification code
    const codeType = normalizedEmail ? "EMAIL" : "PHONE";
    const code = await createVerificationCode(user.id, codeType);

    // Send code (in development, logs to console)
    await sendVerificationCode(normalizedEmail, normalizedPhone, code);

    res.json({
      userId: user.id,
      requiresCode: true,
      message: `Verification code sent to your ${codeType.toLowerCase()}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      next(new BadRequestError(firstError?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

router.post("/logout", authMiddleware, async (req, res, next) => {
  try {
    if (!req.session) {
      throw new BadRequestError("Session not found");
    }

    await prisma.session.delete({
      where: { id: req.session.id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/send-code", async (req, res, next) => {
  try {
    const body = registerLoginSchema.parse(req.body);

    const normalizedEmail = body.email ? body.email.toLowerCase().trim() : null;
    const normalizedPhone = body.phone ? body.phone.trim() : null;

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          normalizedEmail ? { email: normalizedEmail } : {},
          normalizedPhone ? { phone: normalizedPhone } : {},
        ].filter((condition) => Object.keys(condition).length > 0),
      },
      include: {
        profile: true,
      },
    });

    if (!user || !user.profile) {
      throw new BadRequestError("User not found or profile does not exist");
    }

    const codeType = normalizedEmail ? "EMAIL" : "PHONE";
    const code = await createVerificationCode(user.id, codeType);

    await sendVerificationCode(normalizedEmail, normalizedPhone, code);

    res.json({
      message: `Verification code sent to your ${codeType.toLowerCase()}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      next(new BadRequestError(firstError?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

router.post("/verify-code", async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email().toLowerCase().trim().optional(),
      phone: z.string().trim().optional(),
      code: z.string().length(6, "Code must be 6 digits"),
    }).refine((data) => data.email || data.phone, {
      message: "Either email or phone must be provided",
    });

    const body = schema.parse(req.body);

    const normalizedEmail = body.email ? body.email.toLowerCase().trim() : null;
    const normalizedPhone = body.phone ? body.phone.trim() : null;

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          normalizedEmail ? { email: normalizedEmail } : {},
          normalizedPhone ? { phone: normalizedPhone } : {},
        ].filter((condition) => Object.keys(condition).length > 0),
      },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    const isValid = await verifyCode(user.id, body.code);

    // GOOGLE PLAY / APP STORE REVIEW ACCOUNT
    // Configure REVIEWER_PHONE / REVIEWER_EMAIL / REVIEWER_CODE in env to enable.
    // Disabled automatically when REVIEWER_CODE is missing.
    const env = getEnv();
    const reviewerPhone = env.REVIEWER_PHONE?.trim();
    const reviewerEmail = env.REVIEWER_EMAIL?.trim().toLowerCase();
    const reviewerCode = env.REVIEWER_CODE?.trim();
    const reviewerBypassEnabled = Boolean(reviewerCode && (reviewerPhone || reviewerEmail));
    const isReviewerPhone =
      reviewerBypassEnabled &&
      !!reviewerPhone &&
      normalizedPhone === reviewerPhone &&
      body.code === reviewerCode;
    const isReviewerEmail =
      reviewerBypassEnabled &&
      !!reviewerEmail &&
      normalizedEmail === reviewerEmail &&
      body.code === reviewerCode;

    if (!isValid && !isReviewerPhone && !isReviewerEmail) {
      throw new BadRequestError("Invalid or expired verification code");
    }

    // Create session
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = getSessionExpiry();

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    res.json({
      userId: user.id,
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      next(new BadRequestError(firstError?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    // Update lastActiveAt (heartbeat)
    await prisma.user.update({
      where: { id: req.user.id },
      data: { lastActiveAt: new Date() },
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        isPremium: user.isPremium,
        createdAt: user.createdAt,
      },
      profileExists: !!user.profile,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/me", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) throw new BadRequestError("User not found");

    const userId = req.user.id;

    // Transactional deletion
    await prisma.$transaction(async (tx) => {
      // 1. Delete Sessions
      await tx.session.deleteMany({ where: { userId } });

      // 2. Delete Profile
      await tx.profile.deleteMany({ where: { userId } });

      // 3. Delete Verification Codes
      await (tx as any).verificationCode.deleteMany({ where: { userId } });

      // 4. Delete Messages (Sent)
      // Note: We might want to keep messages depending on policy, but "Delete Account" usually means nuke everything.
      // For simplicity/start, we rely on cascades if configured or just delete user.
      // Prisma often requires explicit deletion if no cascade.

      // Delete user (cascade should handle relations if schema allows, 
      // but let's be safe and try deleting User directly hoping for cascade or handle needed ones)

      // In a real app with many relations, you delete relevant data first.
      await tx.user.delete({ where: { id: userId } });
    });

    res.json({ success: true, message: "Account deleted successfully" });
  } catch (error) {
    next(error);
  }
});

// Public endpoint for web form deletion requests
router.post("/request-deletion", async (req, res, next) => {
  try {
    const { email, phone } = req.body;
    if (!email && !phone) {
      throw new BadRequestError("Email or phone is required");
    }

    // Send email to admin
    // In a real app, verifying ownership is better, but for "Request" this is okay.
    await import("../../lib/verification.js").then(m =>
      m.sendVerificationCode(`info@swiip.com`, null, `DELETION REQUEST: ${email || phone}`)
    );

    // Also try to find user and mark for deletion or just notify admin
    // For now, simple notification is enough for "Request" compliance

    res.json({ success: true, message: "Deletion request submitted" });
  } catch (error) {
    next(error);
  }
});

export default router;
