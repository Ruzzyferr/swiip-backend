import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash, randomBytes } from "crypto";

// Load environment variables
dotenv.config();

// Create Prisma client with adapter
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
});

// Helper functions
function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionExpiry(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  return expiry;
}

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Excludes I, O, 0, 1
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getDayKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Istanbul coordinates (approximate)
const ISTANBUL_LAT = 41.0082;
const ISTANBUL_LNG = 28.9784;

// Ankara coordinates
const ANKARA_LAT = 39.9334;
const ANKARA_LNG = 32.8597;

// Izmir coordinates
const IZMIR_LAT = 38.4237;
const IZMIR_LNG = 27.1428;

async function main() {
  console.log("🌱 Starting comprehensive seed...");

  // Clear existing data (in correct order due to foreign keys)
  console.log("🧹 Cleaning existing data...");
  await prisma.message.deleteMany();
  await prisma.conversationRequest.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.match.deleteMany();
  await prisma.swipe.deleteMany();
  await prisma.session.deleteMany();
  await prisma.dailyUsage.deleteMany();
  await prisma.verificationCode.deleteMany();
  await prisma.block.deleteMany();
  await prisma.report.deleteMany();
  await prisma.boost.deleteMany();
  await prisma.pushToken.deleteMany();
  await prisma.billingEvent.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();

  console.log("👥 Creating test users with full profiles...");

  const now = new Date();
  const today = getDayKey();

  // Create users with all new features
  const users = await Promise.all([
    // User 1: Alex - PREMIUM, Active Boost, Has Referral Code
    prisma.user.create({
      data: {
        email: "test@swiip.com".toLowerCase().trim(),
        phone: "+905551234567".trim(),
        isPremium: true,
        premiumSource: "revenuecat",
        premiumUpdatedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        premiumExpiresAt: new Date(now.getTime() + 23 * 24 * 60 * 60 * 1000), // 23 days from now
        lastActiveAt: new Date(now.getTime() - 30 * 60 * 1000), // 30 mins ago
        referralCode: "ALEX01",
        dailyLikesUsed: 5,
        dailyExtraLikesFromAds: 6, // Watched 2 ads (3+3)
        lastLikeResetAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago (same day)
        dailyDirectUsed: 0,
        lastDirectResetAt: now,
        profile: {
          create: {
            displayName: "Alex",
            birthYear: 1995,
            city: "Istanbul",
            country: "TR",
            lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1, // Slight variation
            lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
            gender: "MALE",
            languagesNative: ["Turkish", "English"],
            languagesPractice: ["Spanish", "French"],
            purpose: "CONVERSATION",
            bio: "Love traveling and learning new languages! Looking for interesting conversations and cultural exchange.",
            photos: [
              "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
              "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
            ],
          },
        },
      },
    }),

    // User 2: Maria - PREMIUM, Active Boost, Referred by Alex
    prisma.user.create({
      data: {
        email: "maria@swiip.com".toLowerCase().trim(),
        phone: "+905551234568".trim(),
        isPremium: true,
        premiumSource: "revenuecat",
        premiumUpdatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        premiumExpiresAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
        lastActiveAt: new Date(now.getTime() - 15 * 60 * 1000), // 15 mins ago
        referralCode: "MARIA2",
        referredByUserId: null, // Will set after users are created
        dailyLikesUsed: 0,
        dailyExtraLikesFromAds: 0,
        lastLikeResetAt: now,
        dailyDirectUsed: 0,
        lastDirectResetAt: now,
        profile: {
          create: {
            displayName: "Maria",
            birthYear: 1992,
            city: "Istanbul",
            country: "TR",
            lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
            lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
            gender: "FEMALE",
            languagesNative: ["Turkish", "English"],
            languagesPractice: ["Italian", "German"],
            purpose: "PRACTICE",
            bio: "Language enthusiast! Let's practice together. I'm particularly interested in Italian and German.",
            photos: [
              "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
              "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
            ],
          },
        },
      },
    }),

    // User 3: John - FREE USER, Near Like Limit, Has Used Ads
    prisma.user.create({
      data: {
        email: "john@swiip.com".toLowerCase().trim(),
        phone: "+905551234569".trim(),
        isPremium: false,
        lastActiveAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
        referralCode: "JOHN03",
        dailyLikesUsed: 14, // Near limit (15)
        dailyExtraLikesFromAds: 9, // Watched 3 ads (3+3+3)
        lastLikeResetAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
        dailyDirectUsed: 1, // Used 1 direct message today
        lastDirectResetAt: now,
        profile: {
          create: {
            displayName: "John",
            birthYear: 1990,
            city: "Ankara",
            country: "TR",
            lat: ANKARA_LAT + (Math.random() - 0.5) * 0.1,
            lng: ANKARA_LNG + (Math.random() - 0.5) * 0.1,
            gender: "MALE",
            languagesNative: ["English"],
            languagesPractice: ["Turkish", "Spanish"],
            purpose: "COFFEE",
            bio: "Coffee lover and language learner. Let's meet for a chat! I'm always up for a good conversation over coffee.",
            photos: [
              "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
            ],
          },
        },
      },
    }),

    // User 4: Sophie - PREMIUM, Expired Boost, From France
    prisma.user.create({
      data: {
        email: "sophie@swiip.com".toLowerCase().trim(),
        phone: "+905551234570".trim(),
        isPremium: true,
        premiumSource: "admin",
        premiumUpdatedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        lastActiveAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        referralCode: "SOPHIE",
        dailyLikesUsed: 0,
        dailyExtraLikesFromAds: 0,
        lastLikeResetAt: now,
        dailyDirectUsed: 0,
        lastDirectResetAt: now,
        profile: {
          create: {
            displayName: "Sophie",
            birthYear: 1994,
            city: "Istanbul",
            country: "FR", // French user in Turkey
            lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
            lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
            gender: "FEMALE",
            languagesNative: ["French", "English"],
            languagesPractice: ["Turkish", "Spanish"],
            purpose: "CONVERSATION",
            bio: "Bonjour! I'm new to Istanbul and looking to practice Turkish. Let's chat and explore the city together!",
            photos: [
              "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400",
              "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400",
            ],
          },
        },
      },
    }),

    // User 5: David - FREE USER, At Like Limit
    prisma.user.create({
      data: {
        email: "david@swiip.com".toLowerCase().trim(),
        phone: "+905551234571".trim(),
        isPremium: false,
        lastActiveAt: new Date(now.getTime() - 45 * 60 * 1000),
        referralCode: "DAVID5",
        dailyLikesUsed: 15, // At limit
        dailyExtraLikesFromAds: 0,
        lastLikeResetAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
        dailyDirectUsed: 0,
        lastDirectResetAt: now,
        profile: {
          create: {
            displayName: "David",
            birthYear: 1988,
            city: "Izmir",
            country: "TR",
            lat: IZMIR_LAT + (Math.random() - 0.5) * 0.1,
            lng: IZMIR_LNG + (Math.random() - 0.5) * 0.1,
            gender: "MALE",
            languagesNative: ["English", "German"],
            languagesPractice: ["Turkish"],
            purpose: "PRACTICE",
            bio: "Working professional looking to improve my Turkish skills. Let's practice together!",
            photos: [
              "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
            ],
          },
        },
      },
    }),

    // User 6: Lisa - FREE USER, Has Extra Likes from Ads
    prisma.user.create({
      data: {
        email: "lisa@swiip.com".toLowerCase().trim(),
        phone: "+905551234572".trim(),
        isPremium: false,
        lastActiveAt: new Date(now.getTime() - 20 * 60 * 1000),
        referralCode: "LISA06",
        dailyLikesUsed: 10,
        dailyExtraLikesFromAds: 15, // Watched 5 ads (max)
        lastLikeResetAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
        dailyDirectUsed: 0,
        lastDirectResetAt: now,
        profile: {
          create: {
            displayName: "Lisa",
            birthYear: 1996,
            city: "Istanbul",
            country: "TR",
            lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
            lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
            gender: "FEMALE",
            languagesNative: ["Turkish"],
            languagesPractice: ["English", "French"],
            purpose: "COFFEE",
            bio: "Let's grab coffee and chat! I love meeting new people and learning about different cultures.",
            photos: [
              "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
              "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400",
            ],
          },
        },
      },
    }),

    // User 7: Michael - FREE USER, Blocked by John
    prisma.user.create({
      data: {
        email: "michael@swiip.com".toLowerCase().trim(),
        phone: "+905551234573".trim(),
        isPremium: false,
        lastActiveAt: new Date(now.getTime() - 5 * 60 * 1000),
        referralCode: "MIKE07",
        dailyLikesUsed: 3,
        dailyExtraLikesFromAds: 0,
        lastLikeResetAt: now,
        dailyDirectUsed: 0,
        lastDirectResetAt: now,
        profile: {
          create: {
            displayName: "Michael",
            birthYear: 1991,
            city: "Istanbul",
            country: "TR",
            lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
            lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
            gender: "MALE",
            languagesNative: ["English"],
            languagesPractice: ["Turkish", "Arabic"],
            purpose: "CONVERSATION",
            bio: "Traveler and language exchange enthusiast. Always up for a good conversation!",
            photos: [
              "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
            ],
          },
        },
      },
    }),

    // User 8: Emma - FREE USER, Reported by Sophie
    prisma.user.create({
      data: {
        email: "emma@swiip.com".toLowerCase().trim(),
        phone: "+905551234574".trim(),
        isPremium: false,
        lastActiveAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // 3 days ago (inactive)
        referralCode: "EMMA08",
        dailyLikesUsed: 0,
        dailyExtraLikesFromAds: 0,
        lastLikeResetAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Yesterday (needs reset)
        dailyDirectUsed: 0,
        lastDirectResetAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Yesterday (needs reset)
        profile: {
          create: {
            displayName: "Emma",
            birthYear: 1993,
            city: "Ankara",
            country: "TR",
            lat: ANKARA_LAT + (Math.random() - 0.5) * 0.1,
            lng: ANKARA_LNG + (Math.random() - 0.5) * 0.1,
            gender: "FEMALE",
            languagesNative: ["English", "Spanish"],
            languagesPractice: ["Turkish"],
            purpose: "PRACTICE",
            bio: "Language teacher looking to practice Turkish with native speakers.",
            photos: [
              "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400",
            ],
          },
        },
      },
    }),

    // User 9: Tom - FREE USER, Referred by Alex
    prisma.user.create({
      data: {
        email: "tom@swiip.com".toLowerCase().trim(),
        phone: "+905551234575".trim(),
        isPremium: false,
        lastActiveAt: new Date(now.getTime() - 10 * 60 * 1000),
        referralCode: "TOM009",
        referredByUserId: null, // Will set after users are created
        dailyLikesUsed: 2,
        dailyExtraLikesFromAds: 0,
        lastLikeResetAt: now,
        dailyDirectUsed: 0,
        lastDirectResetAt: now,
        profile: {
          create: {
            displayName: "Tom",
            birthYear: 1989,
            city: "Istanbul",
            country: "TR",
            lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
            lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
            gender: "MALE",
            languagesNative: ["English"],
            languagesPractice: ["Turkish", "German"],
            purpose: "CONVERSATION",
            bio: "New to Istanbul! Looking to make friends and practice languages.",
            photos: [
              "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
            ],
          },
        },
      },
    }),

    // User 10: Sarah - PREMIUM, From UK
    prisma.user.create({
      data: {
        email: "sarah@swiip.com".toLowerCase().trim(),
        phone: "+905551234576".trim(),
        isPremium: true,
        premiumSource: "revenuecat",
        premiumUpdatedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        premiumExpiresAt: new Date(now.getTime() + 27 * 24 * 60 * 60 * 1000),
        lastActiveAt: new Date(now.getTime() - 5 * 60 * 1000),
        referralCode: "SARAH1",
        dailyLikesUsed: 0, // Premium = unlimited
        dailyExtraLikesFromAds: 0,
        lastLikeResetAt: now,
        dailyDirectUsed: 0,
        lastDirectResetAt: now,
        profile: {
          create: {
            displayName: "Sarah",
            birthYear: 1997,
            city: "Istanbul",
            country: "GB", // UK user in Turkey
            lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
            lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
            gender: "FEMALE",
            languagesNative: ["English"],
            languagesPractice: ["Turkish", "French"],
            purpose: "PRACTICE",
            bio: "British expat in Istanbul. Love learning Turkish and meeting locals!",
            photos: [
              "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
              "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
            ],
          },
        },
      },
    }),
  ]);

  console.log(`✅ Created ${users.length} users`);

  // Set referral relationships
  console.log("🔗 Setting up referral relationships...");
  await prisma.user.update({
    where: { id: users[1].id }, // Maria
    data: { referredByUserId: users[0].id }, // Referred by Alex
  });
  await prisma.user.update({
    where: { id: users[8].id }, // Tom
    data: { referredByUserId: users[0].id }, // Referred by Alex
  });
  console.log("✅ Set referral relationships");

  // Create sessions for test users
  console.log("🔐 Creating sessions...");
  const testUser = users[0]; // Alex
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = getSessionExpiry();

  await prisma.session.create({
    data: {
      userId: testUser.id,
      tokenHash,
      expiresAt,
    },
  });

  // Create session for Maria too
  const mariaToken = generateSessionToken();
  const mariaTokenHash = hashSessionToken(mariaToken);
  await prisma.session.create({
    data: {
      userId: users[1].id,
      tokenHash: mariaTokenHash,
      expiresAt,
    },
  });

  console.log(`✅ Created sessions`);

  // Create ConversationRequests (replacing old swipes)
  console.log("💫 Creating conversation requests...");

  // Alex likes Maria (mutual - will create match when accepted)
  const alexLikesMaria = await prisma.conversationRequest.create({
    data: {
      fromUserId: users[0].id,
      toUserId: users[1].id,
      status: "PENDING",
      kind: "LIKE",
    },
  });
  const mariaLikesAlex = await prisma.conversationRequest.create({
    data: {
      fromUserId: users[1].id,
      toUserId: users[0].id,
      status: "ACCEPTED", // Maria already accepted
      kind: "LIKE",
    },
  });

  // Alex likes Sophie (waiting for her to like back)
  await prisma.conversationRequest.create({
    data: {
      fromUserId: users[0].id,
      toUserId: users[3].id,
      status: "PENDING",
      kind: "LIKE",
    },
  });

  // Alex sends FAVORITE (direct message) to Sarah
  const alexFavoritesSarah = await prisma.conversationRequest.create({
    data: {
      fromUserId: users[0].id,
      toUserId: users[9].id,
      status: "PENDING",
      kind: "FAVORITE",
    },
  });
  // Create the first message for the FAVORITE request
  const favoriteMessage = await prisma.message.create({
    data: {
      senderUserId: users[0].id,
      text: "Hi Sarah! I saw your profile and thought we'd have great conversations. Would you like to practice Turkish together?",
      isRequestMessage: true,
      requestId: alexFavoritesSarah.id,
    },
  });
  // Link the first message to the request
  await prisma.conversationRequest.update({
    where: { id: alexFavoritesSarah.id },
    data: { firstMessageId: favoriteMessage.id },
  });
  // Update Alex's direct message usage
  await prisma.user.update({
    where: { id: users[0].id },
    data: { dailyDirectUsed: 1 },
  });

  // David, Lisa, Tom like Alex (incoming requests for Alex)
  await prisma.conversationRequest.create({
    data: {
      fromUserId: users[4].id,
      toUserId: users[0].id,
      status: "PENDING",
      kind: "LIKE",
    },
  });
  await prisma.conversationRequest.create({
    data: {
      fromUserId: users[5].id,
      toUserId: users[0].id,
      status: "PENDING",
      kind: "LIKE",
    },
  });
  await prisma.conversationRequest.create({
    data: {
      fromUserId: users[8].id,
      toUserId: users[0].id,
      status: "PENDING",
      kind: "LIKE",
    },
  });

  // Maria likes Sarah (mutual - will create match when accepted)
  const mariaLikesSarah = await prisma.conversationRequest.create({
    data: {
      fromUserId: users[1].id,
      toUserId: users[9].id,
      status: "PENDING",
      kind: "LIKE",
    },
  });
  const sarahLikesMaria = await prisma.conversationRequest.create({
    data: {
      fromUserId: users[9].id,
      toUserId: users[1].id,
      status: "ACCEPTED", // Sarah already accepted
      kind: "LIKE",
    },
  });

  // John likes Lisa
  await prisma.conversationRequest.create({
    data: {
      fromUserId: users[2].id,
      toUserId: users[5].id,
      status: "PENDING",
      kind: "LIKE",
    },
  });

  // John sends FAVORITE to Emma (direct message)
  const johnFavoritesEmma = await prisma.conversationRequest.create({
    data: {
      fromUserId: users[2].id,
      toUserId: users[7].id,
      status: "PENDING",
      kind: "FAVORITE",
    },
  });
  const johnFavoriteMessage = await prisma.message.create({
    data: {
      senderUserId: users[2].id,
      text: "Hey Emma! I'd love to practice Turkish with you. Are you available for a language exchange?",
      isRequestMessage: true,
      requestId: johnFavoritesEmma.id,
    },
  });
  await prisma.conversationRequest.update({
    where: { id: johnFavoritesEmma.id },
    data: { firstMessageId: johnFavoriteMessage.id },
  });
  // Update John's direct message usage (already at 1 from seed data)
  await prisma.user.update({
    where: { id: users[2].id },
    data: { dailyDirectUsed: 1 },
  });

  // Sophie declines Michael's request (for testing DECLINED status)
  await prisma.conversationRequest.create({
    data: {
      fromUserId: users[6].id,
      toUserId: users[3].id,
      status: "DECLINED",
      kind: "LIKE",
    },
  });

  console.log("✅ Created conversation requests");

  // Create matches (from accepted LIKE requests)
  console.log("💕 Creating matches...");

  // Match: Alex <-> Maria (both accepted)
  // Accept Alex's request to Maria
  await prisma.conversationRequest.update({
    where: { id: alexLikesMaria.id },
    data: { status: "ACCEPTED" },
  });
  const [alexId, mariaId] =
    users[0].id < users[1].id ? [users[0].id, users[1].id] : [users[1].id, users[0].id];
  const match1 = await prisma.match.create({
    data: {
      userAId: alexId,
      userBId: mariaId,
    },
  });

  // Match: Maria <-> Sarah (both accepted)
  // Accept Maria's request to Sarah
  await prisma.conversationRequest.update({
    where: { id: mariaLikesSarah.id },
    data: { status: "ACCEPTED" },
  });
  const [mariaId2, sarahId] =
    users[1].id < users[9].id ? [users[1].id, users[9].id] : [users[9].id, users[1].id];
  const match2 = await prisma.match.create({
    data: {
      userAId: mariaId2,
      userBId: sarahId,
    },
  });

  console.log("✅ Created matches");

  // Create conversations
  console.log("💬 Creating conversations...");

  // Conversation 1: Alex <-> Maria (from match)
  const conversation1 = await prisma.conversation.create({
    data: {
      matchId: match1.id,
    },
  });

  // Conversation 2: Maria <-> Sarah (from match)
  const conversation2 = await prisma.conversation.create({
    data: {
      matchId: match2.id,
    },
  });

  // Conversation 3: Alex -> Sarah (from FAVORITE request - pending, no conversation yet)
  // This will be created when Sarah replies or accepts

  console.log("✅ Created conversations");

  // Create messages
  console.log("📨 Creating messages...");

  await prisma.message.createMany({
    data: [
      {
        conversationId: conversation1.id,
        senderUserId: users[0].id,
        text: "Hi Maria! Nice to match with you! 👋",
      },
      {
        conversationId: conversation1.id,
        senderUserId: users[1].id,
        text: "Hey Alex! Great to meet you too! How are you doing?",
      },
      {
        conversationId: conversation1.id,
        senderUserId: users[0].id,
        text: "I'm doing great! I see you're also interested in language practice. Would you like to practice Spanish together?",
      },
      {
        conversationId: conversation1.id,
        senderUserId: users[1].id,
        text: "That sounds perfect! I'm learning Spanish and would love to practice. When are you free?",
      },
      {
        conversationId: conversation1.id,
        senderUserId: users[0].id,
        text: "How about this weekend? We could meet for coffee if you're up for it!",
      },
      {
        conversationId: conversation2.id,
        senderUserId: users[1].id,
        text: "Hi Sarah! Nice to match!",
      },
      {
        conversationId: conversation2.id,
        senderUserId: users[9].id,
        text: "Hi Maria! Great to meet you too!",
      },
    ],
  });

  console.log("✅ Created messages");

  // Create request messages (for FAVORITE requests)
  console.log("📩 Request messages already created with FAVORITE requests");

  // Create DailyUsage records
  console.log("📊 Creating daily usage records...");

  await prisma.dailyUsage.createMany({
    data: [
      {
        userId: users[0].id, // Alex - Premium
        day: today,
        aiCount: 3,
        msgCount: 15,
      },
      {
        userId: users[1].id, // Maria - Premium
        day: today,
        aiCount: 5,
        msgCount: 20,
      },
      {
        userId: users[2].id, // John - Free, near limits
        day: today,
        aiCount: 8,
        msgCount: 25,
      },
      {
        userId: users[3].id, // Sophie - Premium
        day: today,
        aiCount: 2,
        msgCount: 10,
      },
      {
        userId: users[4].id, // David - Free
        day: today,
        aiCount: 4,
        msgCount: 12,
      },
      {
        userId: users[5].id, // Lisa - Free
        day: today,
        aiCount: 6,
        msgCount: 18,
      },
    ],
  });

  console.log("✅ Created daily usage records");

  // Create Blocks
  console.log("🚫 Creating blocks...");

  await prisma.block.create({
    data: {
      blockerUserId: users[2].id, // John blocks Michael
      blockedUserId: users[6].id,
    },
  });

  console.log("✅ Created blocks");

  // Create Reports
  console.log("📝 Creating reports...");

  await prisma.report.create({
    data: {
      reporterUserId: users[3].id, // Sophie reports Emma
      reportedUserId: users[7].id,
      reason: "SPAM",
      details: "User sending repetitive messages and inappropriate content",
    },
  });

  console.log("✅ Created reports");

  // Create Boosts
  console.log("🚀 Creating boosts...");

  // Alex - Active boost (ends in 2 hours)
  await prisma.boost.create({
    data: {
      userId: users[0].id,
      startsAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // Started 1 hour ago
      endsAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), // Ends in 2 hours
    },
  });

  // Maria - Active boost (ends in 5 hours)
  await prisma.boost.create({
    data: {
      userId: users[1].id,
      startsAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 5 * 60 * 60 * 1000),
    },
  });

  // Sophie - Expired boost (for testing)
  await prisma.boost.create({
    data: {
      userId: users[3].id,
      startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 24 hours ago
      endsAt: new Date(now.getTime() - 12 * 60 * 60 * 1000), // 12 hours ago
    },
  });

  console.log("✅ Created boosts");

  // Create Push Tokens (for testing notifications)
  console.log("📱 Creating push tokens...");

  await prisma.pushToken.createMany({
    data: [
      {
        userId: users[0].id,
        token: "ExponentPushToken[test-token-alex-123]",
        platform: "IOS",
      },
      {
        userId: users[1].id,
        token: "ExponentPushToken[test-token-maria-456]",
        platform: "ANDROID",
      },
    ],
  });

  console.log("✅ Created push tokens");

  // Create Billing Events (for testing webhook logs)
  console.log("💳 Creating billing events...");

  await prisma.billingEvent.createMany({
    data: [
      {
        userId: users[0].id,
        eventType: "SUBSCRIBER",
        payloadJson: JSON.stringify({
          event: {
            type: "SUBSCRIBER",
            app_user_id: users[0].id,
            entitlement_id: "premium",
            expiration_at_ms: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).getTime(),
          },
        }),
      },
      {
        userId: users[1].id,
        eventType: "SUBSCRIBER",
        payloadJson: JSON.stringify({
          event: {
            type: "SUBSCRIBER",
            app_user_id: users[1].id,
            entitlement_id: "premium",
            expiration_at_ms: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).getTime(),
          },
        }),
      },
    ],
  });

  console.log("✅ Created billing events");

  // Print summary
  console.log("\n🎉 Comprehensive seed completed successfully!");
  console.log("\n📋 Test Credentials:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Email: test@swiip.com`);
  console.log(`Phone: +905551234567`);
  console.log(`Token: ${token}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n👥 User Details:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("User 1 (Alex) - PREMIUM:");
  console.log("   - Referral Code: ALEX01");
  console.log("   - 1 match with Maria (with conversation and messages)");
  console.log("   - Liked Sophie (waiting for her to like back)");
  console.log("   - Sent FAVORITE (direct message) to Sarah");
  console.log("   - Has incoming LIKE requests from David, Lisa, and Tom");
  console.log("   - Active boost (ends in 2 hours)");
  console.log("   - Daily usage: 3 AI, 15 messages");
  console.log("   - Daily likes: 5 used, 6 extra from ads (total: 21 available)");
  console.log("   - Daily direct messages: 1 used");
  console.log("   - Referred: Maria and Tom");
  console.log("   - Location: Istanbul, TR");
  console.log("\nUser 2 (Maria) - PREMIUM:");
  console.log("   - Referral Code: MARIA2");
  console.log("   - Referred by: Alex (ALEX01)");
  console.log("   - Active boost (ends in 5 hours)");
  console.log("   - Daily usage: 5 AI, 20 messages");
  console.log("   - Match with Alex (accepted LIKE request)");
  console.log("   - Match with Sarah (accepted LIKE request)");
  console.log("   - Location: Istanbul, TR");
  console.log("\nUser 3 (John) - FREE:");
  console.log("   - Referral Code: JOHN03");
  console.log("   - Near daily limits (8 AI, 25 messages)");
  console.log("   - Near like limit: 14 used + 9 from ads = 23/24 total");
  console.log("   - Daily direct messages: 1 used (sent FAVORITE to Emma)");
  console.log("   - Sent LIKE request to Lisa");
  console.log("   - Blocked User 7 (Michael)");
  console.log("   - Location: Ankara, TR");
  console.log("\nUser 4 (Sophie) - PREMIUM:");
  console.log("   - Referral Code: SOPHIE");
  console.log("   - Expired boost (for testing)");
  console.log("   - Has incoming LIKE request from Alex (pending)");
  console.log("   - Declined LIKE request from Michael");
  console.log("   - Reported User 8 (Emma)");
  console.log("   - Location: Istanbul, TR (from France)");
  console.log("\nUser 5 (David) - FREE:");
  console.log("   - Referral Code: DAVID5");
  console.log("   - At like limit: 15/15 (no extra from ads)");
  console.log("   - Location: Izmir, TR");
  console.log("\nUser 6 (Lisa) - FREE:");
  console.log("   - Referral Code: LISA06");
  console.log("   - Max extra likes from ads: 15 (watched 5 ads)");
  console.log("   - Total likes available: 15 + 15 = 30");
  console.log("   - Location: Istanbul, TR");
  console.log("\nUser 7 (Michael) - FREE:");
  console.log("   - Referral Code: MIKE07");
  console.log("   - Blocked by User 3 (John)");
  console.log("   - Location: Istanbul, TR");
  console.log("\nUser 8 (Emma) - FREE:");
  console.log("   - Referral Code: EMMA08");
  console.log("   - Reported by User 4 (Sophie)");
  console.log("   - Has incoming FAVORITE request from John (with direct message)");
  console.log("   - Inactive (last active 3 days ago)");
  console.log("   - Needs like/direct reset (last reset yesterday)");
  console.log("   - Location: Ankara, TR");
  console.log("\nUser 9 (Tom) - FREE:");
  console.log("   - Referral Code: TOM009");
  console.log("   - Referred by: Alex (ALEX01)");
  console.log("   - Location: Istanbul, TR");
  console.log("\nUser 10 (Sarah) - PREMIUM:");
  console.log("   - Referral Code: SARAH1");
  console.log("   - From UK (GB), living in Istanbul");
  console.log("   - Match with Maria (accepted LIKE request)");
  console.log("   - Has incoming FAVORITE request from Alex (with direct message)");
  console.log("   - Location: Istanbul, TR");
  console.log("\n💡 Testing Scenarios:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Premium Features:");
  console.log("   - Alex, Maria, Sophie, Sarah are premium");
  console.log("   - Unlimited likes, AI, messages");
  console.log("   - Can use boost, see who liked them");
  console.log("\n✅ Free User Limits:");
  console.log("   - John: Near like limit (14/15 + 9 from ads)");
  console.log("   - David: At like limit (15/15)");
  console.log("   - Lisa: Max extra likes from ads (15)");
  console.log("\n✅ Boost Testing:");
  console.log("   - Alex: Active boost (2h remaining)");
  console.log("   - Maria: Active boost (5h remaining)");
  console.log("   - Sophie: Expired boost");
  console.log("\n✅ Safety Features:");
  console.log("   - John blocked Michael");
  console.log("   - Sophie reported Emma");
  console.log("\n✅ Referral System:");
  console.log("   - Alex referred Maria and Tom");
  console.log("   - All users have referral codes");
  console.log("\n✅ Location Data:");
  console.log("   - Istanbul users: Alex, Maria, Sophie, Lisa, Michael, Tom, Sarah");
  console.log("   - Ankara users: John, Emma");
  console.log("   - Izmir users: David");
  console.log("   - International: Sophie (FR), Sarah (GB)");
  console.log("\n✅ Discovery Feed Testing:");
  console.log("   - Blocked users excluded (Michael won't show to John)");
  console.log("   - Reported users excluded (Emma won't show to Sophie)");
  console.log("   - Users with pending/accepted/declined requests excluded from each other");
  console.log("   - Boosted users appear first (Alex, Maria)");
  console.log("   - Cultural preference: Sophie (FR), Sarah (GB) for international");
  console.log("\n✅ Like Limit Testing:");
  console.log("   - David: At limit (should show modal)");
  console.log("   - John: Near limit (14/24)");
  console.log("   - Lisa: Has extra from ads (15)");
  console.log("   - Emma: Needs reset (yesterday's reset)");
  console.log("\n✅ Conversation Request System:");
  console.log("   - LIKE requests: PENDING, ACCEPTED, DECLINED statuses");
  console.log("   - FAVORITE requests: Direct messages with first message");
  console.log("   - Alex -> Sarah: FAVORITE (pending, with message)");
  console.log("   - John -> Emma: FAVORITE (pending, with message)");
  console.log("   - Alex <-> Maria: Mutual LIKE (both ACCEPTED, created match)");
  console.log("   - Maria <-> Sarah: Mutual LIKE (both ACCEPTED, created match)");
  console.log("   - Alex -> Sophie: LIKE (pending, waiting for response)");
  console.log("   - Michael -> Sophie: LIKE (DECLINED)");
  console.log("   - Incoming requests for Alex: David, Lisa, Tom");
  console.log("\n✅ Direct Message Quota:");
  console.log("   - Alex: 1 used (sent to Sarah)");
  console.log("   - John: 1 used (sent to Emma)");
  console.log("   - Others: 0 used");
  console.log("   - Emma: Needs reset (yesterday's reset)");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
