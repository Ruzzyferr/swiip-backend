import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, NotFoundError } from "../../lib/httpErrors.js";

const router = Router();

const purposeEnum = z.enum(["CONVERSATION", "PRACTICE", "COFFEE"]);

const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(40),
  birthYear: z.number().int().min(1940).max(new Date().getFullYear() - 18).optional(),
  city: z.string().trim().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  languagesNative: z.array(z.string()).optional(),
  languagesPractice: z.array(z.string()).optional(),
  purpose: purposeEnum,
  bio: z.string().max(500).optional(),
  photos: z.array(z.string().url()).max(3).optional(),
  interests: z.array(z.string()).optional(),
});

router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const profile = await prisma.profile.findUnique({
      where: { userId: req.user.id },
    });

    if (!profile) {
      throw new NotFoundError("Profile not found");
    }

    res.json(profile);
  } catch (error) {
    next(error);
  }
});

router.put("/me", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const body = updateProfileSchema.parse(req.body);

    const profile = await prisma.profile.upsert({
      where: { userId: req.user.id },
      create: {
        userId: req.user.id,
        displayName: body.displayName,
        birthYear: body.birthYear ?? null,
        city: body.city ?? null,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        languagesNative: body.languagesNative ?? [],
        languagesPractice: body.languagesPractice ?? [],
        purpose: body.purpose,
        bio: body.bio ?? null,
        photos: body.photos ?? [],
        interests: body.interests ?? [],
      },
      update: {
        displayName: body.displayName,
        birthYear: body.birthYear ?? null,
        city: body.city ?? null,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        languagesNative: body.languagesNative ?? [],
        languagesPractice: body.languagesPractice ?? [],
        purpose: body.purpose,
        bio: body.bio ?? null,
        photos: body.photos ?? [],
        interests: body.interests ?? [],
      },
    });

    res.json(profile);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      if (!firstError) {
        next(new BadRequestError("Validation error"));
        return;
      }
      
      let message = firstError.message;
      
      // Provide friendly error messages
      if (firstError.path.some((p) => String(p) === "displayName")) {
        message = "Display name must be between 2 and 40 characters";
      } else if (firstError.path.some((p) => String(p) === "birthYear")) {
        message = "You must be at least 18 years old";
      } else if (firstError.path.some((p) => String(p) === "bio")) {
        message = "Bio must be 500 characters or less";
      } else if (firstError.path.some((p) => String(p) === "photos")) {
        message = "You can upload up to 3 photos, and each must be a valid URL";
      }
      
      next(new BadRequestError(message));
    } else {
      next(error);
    }
  }
});

router.get("/:userId", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const userId = req.params.userId;

    const profile = await prisma.profile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundError("Profile not found");
    }

    res.json(profile);
  } catch (error) {
    next(error);
  }
});

export default router;
