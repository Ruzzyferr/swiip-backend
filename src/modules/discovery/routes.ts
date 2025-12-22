import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, ConflictError, NotFoundError, PaymentRequiredError } from "../../lib/httpErrors.js";
import { calculateDistanceKm, EU_COUNTRIES } from "../../lib/distance.js";
import { notifyNewMatch } from "../../lib/notify.js";
import { canLike, incrementLike } from "../../lib/usage.js";

const router = Router();

const likeSchema = z.object({
  toUserId: z.string().cuid(),
});

const passSchema = z.object({
  toUserId: z.string().cuid(),
});

// Helper: Get canonical user pair (lower ID first)
function getCanonicalPair(userId1: string, userId2: string): [string, string] {
  return userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
}

// Helper: Check if profile exists
async function ensureProfileExists(userId: string): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
  });
  if (!profile) {
    throw new ConflictError("Profile required. Please complete your profile first.");
  }
}

// Filter query schema
const feedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  maxDistanceKm: z.coerce.number().positive().nullable().optional(),
  languages: z.string().array().optional(),
  purpose: z.enum(["CONVERSATION", "PRACTICE", "COFFEE"]).optional(),
  culturalPreference: z.enum(["LOCAL", "EUROPE", "INTERNATIONAL"]).optional(),
  excludeCountries: z.string().array().optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  recentlyActive: z.coerce.boolean().optional(),
  minPhotos: z.coerce.number().int().nonnegative().optional(),
});

router.get("/feed", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    await ensureProfileExists(req.user.id);

    // Parse and validate query params
    const queryParams = feedQuerySchema.parse(req.query);
    const limit = Math.min(queryParams.limit || 20, 50);

    // Get current user with profile
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true },
    });

    if (!currentUser?.profile) {
      throw new ConflictError("Profile required");
    }

    // Check premium status for premium-only filters
    const isPremium = currentUser.isPremium;
    if (!isPremium) {
      // Silently ignore premium filters if user is not premium
      if (queryParams.excludeCountries || queryParams.verifiedOnly || queryParams.recentlyActive || queryParams.minPhotos) {
        // Optionally return 402, but we'll silently ignore for better UX
        // throw new PaymentRequiredError("PREMIUM_REQUIRED", "Premium filters require a premium subscription.");
      }
    }

    // Get users I've already swiped on
    // Note: If you get "Cannot read properties of undefined", run: pnpm prisma:generate
    const mySwipes = await (prisma as any).swipe.findMany({
      where: { fromUserId: req.user.id },
      select: { toUserId: true },
    });
    const swipedUserIds = new Set(mySwipes.map((s: { toUserId: string }) => s.toUserId));

    // Get blocked users (both ways)
    const blocksWhereIBlocked = await (prisma as any).block.findMany({
      where: { blockerUserId: req.user.id },
      select: { blockedUserId: true },
    });
    const blocksWhereIWasBlocked = await (prisma as any).block.findMany({
      where: { blockedUserId: req.user.id },
      select: { blockerUserId: true },
    });
    const blockedUserIds = new Set([
      ...blocksWhereIBlocked.map((b: { blockedUserId: string }) => b.blockedUserId),
      ...blocksWhereIWasBlocked.map((b: { blockerUserId: string }) => b.blockerUserId),
    ]);

    // Get reported users (exclude them)
    const myReports = await (prisma as any).report.findMany({
      where: { reporterUserId: req.user.id },
      select: { reportedUserId: true },
    });
    const reportedUserIds = new Set(myReports.map((r: { reportedUserId: string }) => r.reportedUserId));

    // Get active boosts
    const now = new Date();
    const activeBoosts = await (prisma as any).boost.findMany({
      where: {
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      select: { userId: true },
    });
    const boostedUserIds = new Set(activeBoosts.map((b: { userId: string }) => b.userId));

    // Combine excluded user IDs
    const excludedUserIds = new Set([
      req.user.id,
      ...blockedUserIds,
      ...reportedUserIds,
    ]);

    const currentProfile = currentUser.profile;
    if (!currentProfile) {
      throw new ConflictError("Profile required");
    }

    // Build where clause for database query
    const whereClause: any = {
      userId: {
        notIn: Array.from(excludedUserIds),
      },
      user: {
        isBanned: false,
      },
    };

    // Apply purpose filter (FREE)
    if (queryParams.purpose) {
      whereClause.purpose = queryParams.purpose;
    }

    // Apply language filter (FREE) - matches if user speaks OR practices any of the languages
    // Note: We'll filter languages in memory after fetching to avoid complex Prisma queries

    // Apply premium filters (only if user is premium)
    if (isPremium) {
      if (queryParams.excludeCountries && queryParams.excludeCountries.length > 0) {
        whereClause.country = {
          notIn: queryParams.excludeCountries,
        };
      }
      // Note: minPhotos, verifiedOnly, and recentlyActive will be filtered in memory
    }

    // Get all profiles matching filters
    const allProfiles = await prisma.profile.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            isBanned: true,
            isPremium: true,
          },
        },
      },
    });

    // Filter out swiped users
    let availableProfiles = allProfiles.filter(
      (p) => !swipedUserIds.has(p.userId)
    );

    // Apply language filter (FREE, in-memory) - matches if user speaks OR practices any of the languages
    if (queryParams.languages && queryParams.languages.length > 0) {
      availableProfiles = availableProfiles.filter((profile) => {
        const hasNativeMatch = queryParams.languages!.some((lang) =>
          profile.languagesNative.includes(lang)
        );
        const hasPracticeMatch = queryParams.languages!.some((lang) =>
          profile.languagesPractice.includes(lang)
        );
        return hasNativeMatch || hasPracticeMatch;
      });
    }

    // Apply minPhotos filter (premium, in-memory)
    if (isPremium && queryParams.minPhotos !== undefined && queryParams.minPhotos > 0) {
      availableProfiles = availableProfiles.filter(
        (p) => p.photos.length >= queryParams.minPhotos!
      );
    }

    // Apply distance filter (FREE, only if maxDistanceKm is provided)
    if (queryParams.maxDistanceKm !== null && queryParams.maxDistanceKm !== undefined && currentProfile.lat && currentProfile.lng) {
      availableProfiles = availableProfiles.filter((profile) => {
        if (!profile.lat || !profile.lng) return false;
        const distance = calculateDistanceKm(
          currentProfile.lat,
          currentProfile.lng,
          profile.lat,
          profile.lng
        );
        return distance <= queryParams.maxDistanceKm!;
      });
    }

    // Check if no profiles available
    if (availableProfiles.length === 0) {
      return res.json([]);
    }

    // Score and rank profiles
    const scoredProfiles = availableProfiles.map((profile) => {
      let score = 0;
      let distanceKm: number | undefined;

      // 1) Active boost (highest priority)
      if (boostedUserIds.has(profile.userId)) {
        score += 1000;
      }

      // 2) Cultural preference match (soft ranking)
      if (queryParams.culturalPreference && currentProfile.country) {
        if (queryParams.culturalPreference === "LOCAL" && profile.country === currentProfile.country) {
          score += 50;
        } else if (queryParams.culturalPreference === "EUROPE" && profile.country && EU_COUNTRIES.includes(profile.country)) {
          score += 30;
        }
        // INTERNATIONAL: no bonus
      }

      // 3) Language overlap bonus
      const nativeOverlap = currentProfile.languagesNative.filter((lang) =>
        profile.languagesNative.includes(lang)
      ).length;
      const practiceOverlap = currentProfile.languagesPractice.filter(
        (lang) => profile.languagesPractice.includes(lang)
      ).length;
      score += nativeOverlap * 5;
      score += practiceOverlap * 3;

      // 4) Distance bonus (if maxDistanceKm is set, closer = better)
      if (queryParams.maxDistanceKm !== null && queryParams.maxDistanceKm !== undefined && currentProfile.lat && currentProfile.lng && profile.lat && profile.lng) {
        distanceKm = calculateDistanceKm(
          currentProfile.lat,
          currentProfile.lng,
          profile.lat,
          profile.lng
        );
        // Closer profiles get a small bonus (inverse distance, max 20 points)
        const distanceBonus = Math.max(0, 20 - distanceKm / 5);
        score += distanceBonus;
      }

      // 5) City match bonus (small)
      if (
        currentProfile.city &&
        profile.city &&
        currentProfile.city.toLowerCase() === profile.city.toLowerCase()
      ) {
        score += 10;
      }

      return { profile, score, distanceKm };
    });

    // Sort by score (descending), then by distance (if available), then randomize
    scoredProfiles.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // If scores are equal and distance is available, prefer closer
      if (a.distanceKm !== undefined && b.distanceKm !== undefined) {
        return a.distanceKm - b.distanceKm;
      }
      return Math.random() - 0.5; // Randomize same scores
    });

    // Take top N
    const selectedProfiles = scoredProfiles.slice(0, limit);

    // Format response
    const discoveryCards = selectedProfiles.map(({ profile, distanceKm }) => ({
      userId: profile.userId,
      distanceKm: distanceKm, // Only included if maxDistanceKm was provided
      profile: {
        displayName: profile.displayName,
        birthYear: profile.birthYear,
        city: profile.city,
        purpose: profile.purpose,
        bio: profile.bio,
        photos: profile.photos,
        languagesNative: profile.languagesNative,
        languagesPractice: profile.languagesPractice,
      },
    }));

    res.json(discoveryCards);
  } catch (error) {
    next(error);
  }
});

router.post("/like", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    await ensureProfileExists(req.user.id);

    const body = likeSchema.parse(req.body);

    if (body.toUserId === req.user.id) {
      throw new BadRequestError("Cannot like yourself");
    }

    // Get user premium status
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isPremium: true },
    });

    if (!currentUser) {
      throw new BadRequestError("User not found");
    }

    // Check like limit (premium users have unlimited)
    const likeCheck = await canLike(req.user.id, currentUser.isPremium);
    if (!likeCheck.canLike) {
      return res.status(429).json({
        error: {
          code: "LIKE_LIMIT_REACHED",
          message: "Daily like limit reached. Watch an ad for more likes or upgrade to Premium.",
          requestId: req.id || "unknown",
          details: {
            likesUsed: likeCheck.likesUsed,
            likesRemaining: likeCheck.likesRemaining,
            likesLimit: likeCheck.likesLimit,
            isPremium: currentUser.isPremium,
          },
        },
      });
    }

    // Check if target user exists and has profile
    const targetUser = await prisma.user.findUnique({
      where: { id: body.toUserId },
      include: { profile: true },
    });

    if (!targetUser || targetUser.isBanned) {
      throw new NotFoundError("User not found");
    }

    if (!targetUser.profile) {
      throw new NotFoundError("User profile not found");
    }

    // Increment like count (after validation, before creating swipe)
    await incrementLike(req.user.id, currentUser.isPremium);

    // Upsert swipe
    await (prisma as any).swipe.upsert({
      where: {
        fromUserId_toUserId: {
          fromUserId: req.user.id,
          toUserId: body.toUserId,
        },
      },
      create: {
        fromUserId: req.user.id,
        toUserId: body.toUserId,
        type: "LIKE",
      },
      update: {
        type: "LIKE",
      },
    });

    // Check if other user has already liked me
    const reverseSwipe = await (prisma as any).swipe.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: body.toUserId,
          toUserId: req.user.id,
        },
      },
    });

    let matched = false;
    let matchId: string | undefined;
    let conversationId: string | undefined;

    if (reverseSwipe?.type === "LIKE") {
      // Create match with canonical ordering
      const [userAId, userBId] = getCanonicalPair(req.user.id, body.toUserId);

      const match = await (prisma as any).match.upsert({
        where: {
          userAId_userBId: {
            userAId,
            userBId,
          },
        },
        create: {
          userAId,
          userBId,
        },
        update: {},
      });

      matched = true;
      matchId = match.id;

      // Create conversation if not exists
      const conversation = await (prisma as any).conversation.upsert({
        where: {
          matchId: match.id,
        },
        create: {
          matchId: match.id,
        },
        update: {},
      });

      conversationId = conversation.id;

      // Notify both users of the new match
      const otherUserProfile = targetUser.profile;
      const currentUserProfile = await prisma.profile.findUnique({
        where: { userId: req.user.id },
        select: { displayName: true },
      });

      if (otherUserProfile && currentUserProfile) {
        // Notify the other user
        await notifyNewMatch(body.toUserId, currentUserProfile.displayName);
        // Notify current user
        await notifyNewMatch(req.user.id, otherUserProfile.displayName);
      }
    }

    res.json({
      matched,
      matchId,
      conversationId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

router.post("/pass", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    await ensureProfileExists(req.user.id);

    const body = passSchema.parse(req.body);

    if (body.toUserId === req.user.id) {
      throw new BadRequestError("Cannot pass on yourself");
    }

    // Upsert swipe
    await (prisma as any).swipe.upsert({
      where: {
        fromUserId_toUserId: {
          fromUserId: req.user.id,
          toUserId: body.toUserId,
        },
      },
      create: {
        fromUserId: req.user.id,
        toUserId: body.toUserId,
        type: "PASS",
      },
      update: {
        type: "PASS",
      },
    });

    res.status(204).send();
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

export default router;
