import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, ConflictError, NotFoundError, PaymentRequiredError } from "../../lib/httpErrors.js";
import { calculateDistanceKm, EU_COUNTRIES } from "../../lib/distance.js";
import { notifyNewMatch } from "../../lib/notify.js";
import { canLike, incrementLike, canSendDirect, incrementDirect } from "../../lib/usage.js";
import { StorageService } from "../../lib/storage.js";

const router = Router();

const likeSchema = z.object({
  toUserId: z.string().cuid(),
});

const passSchema = z.object({
  toUserId: z.string().cuid(),
});

const favoriteSchema = z.object({
  toUserId: z.string().cuid(),
  text: z.string().min(10).max(2000),
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

// Helper to parse array from query string (handles both string and array input)
const parseStringArray = (val: unknown): string[] => {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === "string");
  if (typeof val === "string") return val.split(",").map(s => s.trim()).filter(Boolean);
  return [];
};

// Helper to parse tuple from query string
const parseTuple = (val: unknown): [number, number] | undefined => {
  if (val === undefined || val === null) return undefined;
  if (Array.isArray(val) && val.length === 2) {
    return [Number(val[0]), Number(val[1])];
  }
  if (typeof val === "string") {
    const parts = val.split(",").map(s => Number(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return [parts[0], parts[1]];
    }
  }
  return undefined;
};

// Filter query schema
const feedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  maxDistanceKm: z.coerce.number().positive().nullable().optional(),
  // New filters
  ageRange: z.preprocess(parseTuple, z.tuple([z.number().int().min(18), z.number().int().max(100)]).optional()),
  gender: z.enum(["ALL", "FEMALE", "MALE"]).optional(),
  nativeLanguages: z.preprocess(parseStringArray, z.string().array()),
  targetLanguages: z.preprocess(parseStringArray, z.string().array()),
  countries: z.preprocess(parseStringArray, z.string().array()),
  // Existing filters
  languages: z.preprocess(parseStringArray, z.string().array()),
  purpose: z.enum(["CONVERSATION", "PRACTICE", "COFFEE"]).optional(),
  culturalPreference: z.enum(["LOCAL", "EUROPE", "INTERNATIONAL"]).optional(),
  excludeCountries: z.preprocess(parseStringArray, z.string().array()),
  // Premium filters
  verifiedOnly: z.coerce.boolean().optional(),
  recentlyActive: z.coerce.boolean().optional(),
  minPhotos: z.coerce.number().int().nonnegative().optional(),
  // Force reshuffle when filters change
  forceReshuffle: z.coerce.boolean().optional(),
});

router.get("/feed", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    await ensureProfileExists(req.user.id);

    // Normalize query params - convert bracket notation keys (nativeLanguages[]) to regular keys
    const normalizedQuery: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.query)) {
      // Remove trailing [] from keys
      const normalizedKey = key.replace(/\[\]$/, "");
      // If key already exists, make it an array
      if (normalizedQuery[normalizedKey] !== undefined) {
        const existing = normalizedQuery[normalizedKey];
        if (Array.isArray(existing)) {
          normalizedQuery[normalizedKey] = [...existing, value];
        } else {
          normalizedQuery[normalizedKey] = [existing, value];
        }
      } else {
        normalizedQuery[normalizedKey] = value;
      }
    }

    // Parse and validate query params
    const queryParams = feedQuerySchema.parse(normalizedQuery);
    const limit = Math.min(queryParams.limit || 20, 50);

    // Debug: log raw query and parsed filters
    console.log("[Feed] Raw query:", req.query);
    console.log("[Feed] Normalized query:", normalizedQuery);
    console.log("[Feed] Parsed filters:", {
      nativeLanguages: queryParams.nativeLanguages,
      targetLanguages: queryParams.targetLanguages,
      countries: queryParams.countries,
      gender: queryParams.gender,
      ageRange: queryParams.ageRange,
    });

    // Get current user with profile
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true },
    });

    if (!currentUser?.profile) {
      throw new ConflictError("Profile required");
    }

    // Check if we need to shuffle (12-hour cache OR forceReshuffle)
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const needsShuffle = queryParams.forceReshuffle || !currentUser.lastFeedShuffleAt || currentUser.lastFeedShuffleAt < twelveHoursAgo;

    // If shuffle needed, update timestamp
    if (needsShuffle) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { lastFeedShuffleAt: now },
      });
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

    // Get users I've already swiped on (PASS only - LIKE/FAVORITE are now ConversationRequests)
    // Execute all exclusion queries in PARALLEL for better performance
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [
      mySwipes,
      outgoingRequests,
      incomingRequests,
      blocksWhereIBlocked,
      blocksWhereIWasBlocked,
      myReports,
      activeBoosts,
    ] = await Promise.all([
      // Query 1: My PASS swipes
      (prisma as any).swipe.findMany({
        where: {
          fromUserId: req.user.id,
          type: "PASS",
        },
        select: { toUserId: true },
      }),
      // Query 2: Outgoing conversation requests
      (prisma as any).conversationRequest.findMany({
        where: {
          fromUserId: req.user.id,
          OR: [
            { status: "PENDING" },
            { status: "ACCEPTED" },
            {
              status: "DECLINED",
              updatedAt: { gte: oneWeekAgo },
            },
          ],
        },
        select: { toUserId: true },
      }),
      // Query 3: Incoming conversation requests
      (prisma as any).conversationRequest.findMany({
        where: {
          toUserId: req.user.id,
          OR: [
            {
              status: "PENDING",
              createdAt: { gte: oneWeekAgo },
            },
            { status: "ACCEPTED" },
            {
              status: "DECLINED",
              updatedAt: { gte: oneWeekAgo },
            },
          ],
        },
        select: { fromUserId: true },
      }),
      // Query 4: Users I blocked
      (prisma as any).block.findMany({
        where: { blockerUserId: req.user.id },
        select: { blockedUserId: true },
      }),
      // Query 5: Users who blocked me
      (prisma as any).block.findMany({
        where: { blockedUserId: req.user.id },
        select: { blockerUserId: true },
      }),
      // Query 6: Users I reported
      (prisma as any).report.findMany({
        where: { reporterUserId: req.user.id },
        select: { reportedUserId: true },
      }),
      // Query 7: Active boosts
      (prisma as any).boost.findMany({
        where: {
          startsAt: { lte: now },
          endsAt: { gte: now },
        },
        select: { userId: true },
      }),
    ]);

    // Process results into Sets
    const swipedUserIds = new Set(mySwipes.map((s: { toUserId: string }) => s.toUserId));
    const requestUserIds = new Set([
      ...outgoingRequests.map((r: { toUserId: string }) => r.toUserId),
      ...incomingRequests.map((r: { fromUserId: string }) => r.fromUserId),
    ]);
    const blockedUserIds = new Set([
      ...blocksWhereIBlocked.map((b: { blockedUserId: string }) => b.blockedUserId),
      ...blocksWhereIWasBlocked.map((b: { blockerUserId: string }) => b.blockerUserId),
    ]);
    const reportedUserIds = new Set(myReports.map((r: { reportedUserId: string }) => r.reportedUserId));
    const boostedUserIds = new Set(activeBoosts.map((b: { userId: string }) => b.userId));


    // Combine excluded user IDs
    const excludedUserIds = new Set([
      req.user.id,
      ...swipedUserIds, // PASS swipes
      ...requestUserIds, // ConversationRequests (any status)
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

    // Apply gender filter (FREE, in-memory)
    if (queryParams.gender && queryParams.gender !== "ALL") {
      availableProfiles = availableProfiles.filter((profile) => {
        return profile.gender === queryParams.gender;
      });
    }

    // Apply age range filter (FREE, in-memory)
    if (queryParams.ageRange) {
      const currentYear = new Date().getFullYear();
      const [minAge, maxAge] = queryParams.ageRange;
      availableProfiles = availableProfiles.filter((profile) => {
        if (!profile.birthYear) return false;
        const age = currentYear - profile.birthYear;
        return age >= minAge && age <= maxAge;
      });
    }

    // Apply native language filter (FREE, in-memory)
    if (queryParams.nativeLanguages && queryParams.nativeLanguages.length > 0) {
      availableProfiles = availableProfiles.filter((profile) => {
        return queryParams.nativeLanguages!.some((lang) =>
          profile.languagesNative.includes(lang)
        );
      });
    }

    // Apply target/practice language filter (FREE, in-memory)
    if (queryParams.targetLanguages && queryParams.targetLanguages.length > 0) {
      availableProfiles = availableProfiles.filter((profile) => {
        return queryParams.targetLanguages!.some((lang) =>
          profile.languagesPractice.includes(lang)
        );
      });
    }

    // Apply country filter (FREE, in-memory)
    if (queryParams.countries && queryParams.countries.length > 0) {
      availableProfiles = availableProfiles.filter((profile) => {
        return profile.country && queryParams.countries!.includes(profile.country);
      });
    }

    // Apply language filter (legacy, in-memory) - matches if user speaks OR practices any of the languages
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
      const userLat = currentProfile.lat;
      const userLng = currentProfile.lng;
      availableProfiles = availableProfiles.filter((profile) => {
        if (!profile.lat || !profile.lng) return false;
        const distance = calculateDistanceKm(
          userLat,
          userLng,
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

      // 4) Distance calculation (always calculate if both users have location)
      if (currentProfile.lat && currentProfile.lng && profile.lat && profile.lng) {
        distanceKm = calculateDistanceKm(
          currentProfile.lat,
          currentProfile.lng,
          profile.lat,
          profile.lng
        );

        // Distance bonus (if maxDistanceKm is set, closer = better)
        if (queryParams.maxDistanceKm !== null && queryParams.maxDistanceKm !== undefined) {
          // Closer profiles get a small bonus (inverse distance, max 20 points)
          const distanceBonus = Math.max(0, 20 - distanceKm / 5);
          score += distanceBonus;
        }
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

    // Sort by score (descending), then by distance (if available)
    scoredProfiles.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // If scores are equal and distance is available, prefer closer
      if (a.distanceKm !== undefined && b.distanceKm !== undefined) {
        return a.distanceKm - b.distanceKm;
      }
      return 0; // Keep original order for same scores
    });

    // Apply shuffle if needed (12-hour cache)
    if (needsShuffle) {
      // Use deterministic seed based on current timestamp for consistent results within 12 hours
      // Round to 12-hour periods so same period = same shuffle
      const twelveHourPeriod = Math.floor(now.getTime() / (12 * 60 * 60 * 1000));
      const shuffleSeed = twelveHourPeriod;

      // Simple seeded random function (linear congruential generator)
      let seed = shuffleSeed;
      const seededRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      // Fisher-Yates shuffle with seeded random
      for (let i = scoredProfiles.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [scoredProfiles[i], scoredProfiles[j]] = [scoredProfiles[j], scoredProfiles[i]];
      }
    } else {
      // Even if not shuffling, apply a small randomization to same-scored profiles
      // This prevents exact same order every time within the 12-hour window
      scoredProfiles.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (a.distanceKm !== undefined && b.distanceKm !== undefined) {
          return a.distanceKm - b.distanceKm;
        }
        // Use userId hash for deterministic but varied ordering
        const hashA = a.profile.userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const hashB = b.profile.userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return hashA - hashB;
      });
    }

    // Take top N
    const selectedProfiles = scoredProfiles.slice(0, limit);

    // Format response and transform photo URLs to presigned URLs
    const discoveryCards = await Promise.all(
      selectedProfiles.map(async ({ profile, distanceKm }) => {
        // Transform photo URLs to presigned URLs for private MinIO buckets
        const photos = await StorageService.transformPhotoUrls(profile.photos, 3600); // 1 hour expiry

        return {
          userId: profile.userId,
          distanceKm: distanceKm, // Only included if maxDistanceKm was provided
          profile: {
            displayName: profile.displayName,
            birthYear: profile.birthYear,
            city: profile.city,
            purpose: profile.purpose,
            bio: profile.bio,
            photos: photos,
            languagesNative: profile.languagesNative,
            languagesPractice: profile.languagesPractice,
          },
        };
      })
    );

    res.json(discoveryCards);
  } catch (error) {
    next(error);
  }
});

router.post("/like", authMiddleware, async (req, res, next) => {
  // NEW SYSTEM: Create PENDING ConversationRequest with kind=LIKE
  // No match creation - only when accepted
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

    // Check if request already exists
    const existingRequest = await (prisma as any).conversationRequest.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: req.user.id,
          toUserId: body.toUserId,
        },
      },
    });

    if (existingRequest) {
      return res.status(409).json({
        error: {
          code: "REQUEST_ALREADY_SENT",
          message: "You have already sent a request to this user",
          requestId: req.id || "unknown",
        },
      });
    }

    // Check reverse request (they sent to me)
    const reverseRequest = await (prisma as any).conversationRequest.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: body.toUserId,
          toUserId: req.user.id,
        },
      },
    });

    // Increment like count
    await incrementLike(req.user.id, currentUser.isPremium);

    let matchId: string | undefined;
    let conversationId: string | undefined;
    let requestId: string;

    // If reverse request exists and it's a LIKE, create match immediately
    if (reverseRequest && reverseRequest.kind === "LIKE" && reverseRequest.status === "PENDING") {
      // Both users liked each other - create Match immediately
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

      matchId = match.id;

      // Create conversation linked to match
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

      // Update reverse request status to ACCEPTED
      await (prisma as any).conversationRequest.update({
        where: { id: reverseRequest.id },
        data: { status: "ACCEPTED" },
      });

      // Create my request as ACCEPTED (since we matched)
      const request = await (prisma as any).conversationRequest.create({
        data: {
          fromUserId: req.user.id,
          toUserId: body.toUserId,
          status: "ACCEPTED",
          kind: "LIKE",
        },
      });

      requestId = request.id;

      // Notify both users
      const targetUserProfile = targetUser.profile;
      const currentUserProfile = await prisma.profile.findUnique({
        where: { userId: req.user.id },
        select: { displayName: true },
      });

      if (targetUserProfile && currentUserProfile) {
        await notifyNewMatch(body.toUserId, currentUserProfile.displayName);
        await notifyNewMatch(req.user.id, targetUserProfile.displayName);
      }

      return res.json({
        success: true,
        requestId,
        matchId,
        conversationId,
        matched: true,
      });
    } else if (reverseRequest && reverseRequest.kind === "FAVORITE") {
      // They sent a FAVORITE request - we can't like them, they need to accept/decline first
      return res.status(409).json({
        error: {
          code: "REQUEST_ALREADY_EXISTS",
          message: "This user has already sent you a request. Please accept or decline it first.",
          requestId: req.id || "unknown",
        },
      });
    }

    // No reverse request or it's not a LIKE - create PENDING ConversationRequest
    const request = await (prisma as any).conversationRequest.create({
      data: {
        fromUserId: req.user.id,
        toUserId: body.toUserId,
        status: "PENDING",
        kind: "LIKE",
      },
    });

    requestId = request.id;

    res.json({
      success: true,
      requestId,
      matched: false,
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

router.post("/favorite", authMiddleware, async (req, res, next) => {
  // NEW SYSTEM: Create PENDING ConversationRequest with kind=FAVORITE
  // Also create first message immediately
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    await ensureProfileExists(req.user.id);

    const body = favoriteSchema.parse(req.body);

    if (body.toUserId === req.user.id) {
      throw new BadRequestError("Cannot favorite yourself");
    }

    // Get user premium status
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isPremium: true },
    });

    if (!currentUser) {
      throw new BadRequestError("User not found");
    }

    // Check direct message quota
    const directCheck = await canSendDirect(req.user.id, currentUser.isPremium);
    if (!directCheck.canSend) {
      return res.status(429).json({
        error: {
          code: "DIRECT_LIMIT_REACHED",
          message: "Daily direct message limit reached. Upgrade to Premium for unlimited direct messages.",
          requestId: req.id || "unknown",
          details: {
            directUsed: directCheck.directUsed,
            directRemaining: directCheck.directRemaining,
            directLimit: directCheck.directLimit,
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

    // Check if request already exists
    const existingRequest = await (prisma as any).conversationRequest.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: req.user.id,
          toUserId: body.toUserId,
        },
      },
    });

    if (existingRequest) {
      return res.status(409).json({
        error: {
          code: "REQUEST_ALREADY_SENT",
          message: "You have already sent a request to this user",
          requestId: req.id || "unknown",
        },
      });
    }

    // Check reverse request (they sent to me)
    const reverseRequest = await (prisma as any).conversationRequest.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: body.toUserId,
          toUserId: req.user.id,
        },
      },
    });

    if (reverseRequest) {
      return res.status(409).json({
        error: {
          code: "REQUEST_ALREADY_EXISTS",
          message: "This user has already sent you a request. Please accept or decline it first.",
          requestId: req.id || "unknown",
        },
      });
    }

    // Increment direct message count
    const directResult = await incrementDirect(req.user.id, currentUser.isPremium);

    // Create PENDING ConversationRequest with kind=FAVORITE
    const request = await (prisma as any).conversationRequest.create({
      data: {
        fromUserId: req.user.id,
        toUserId: body.toUserId,
        status: "PENDING",
        kind: "FAVORITE",
      },
    });

    // Create first message
    const firstMessage = await (prisma as any).message.create({
      data: {
        senderUserId: req.user.id,
        text: body.text,
        isRequestMessage: true,
        requestId: request.id,
      },
    });

    // Update request with firstMessageId
    await (prisma as any).conversationRequest.update({
      where: { id: request.id },
      data: { firstMessageId: firstMessage.id },
    });

    res.json({
      success: true,
      requestId: request.id,
      messageId: firstMessage.id,
      directRemaining: directResult.directRemaining,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

export default router;
