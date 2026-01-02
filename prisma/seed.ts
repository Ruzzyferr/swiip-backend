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

// Helper to upload images from URL to S3/MinIO
async function uploadFromUrl(url: string): Promise<string> {
  // If S3 is not configured, just return the original URL to save time/errors
  if (!process.env.S3_BUCKET && !process.env.S3_ENDPOINT) {
    console.warn("⚠️ S3 not configured, skipping image upload.");
    return url;
  }

  // Dynamic import to avoid loading env vars before dotenv.config()
  const { StorageService } = await import("../src/lib/storage");

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Mock Multer File (using any to avoid type issues in seed script)
    const mockFile: any = {
      fieldname: 'file',
      originalname: 'seed-image.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      buffer: buffer,
      size: buffer.length,
      destination: '',
      filename: '',
      path: '',
      stream: null as any
    };

    const s3Url = await StorageService.uploadFile(mockFile, "profiles");
    return s3Url;
  } catch (error) {
    console.error(`Failed to upload image from ${url}:`, error);
    return url; // Fallback to original URL
  }
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
    // User 1: Alex - PREMIUM matched with Maria
    (async () => {
      const alexPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
        "https://images.unsplash.com/photo-1480455624313-e29b44bbfde1?w=400",
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "alex@swiip.com" },
        update: {
          profile: {
            update: {
              photos: alexPhotos,
            }
          }
        },
        create: {
          email: "alex@swiip.com",
          phone: "+905551234567",
          isPremium: false,
          premiumSource: "stripe",
          premiumUpdatedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
          premiumExpiresAt: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000), // 20 days left
          lastActiveAt: now,
          referralCode: "ALEX01",
          dailyLikesUsed: 5,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 2,
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
              photos: alexPhotos,
            },
          },
        },
      });
    })(),

    // User 2: Maria - PREMIUM, Active Boost, Referred by Alex
    (async () => {
      const mariaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "maria@swiip.com" },
        update: {
          profile: {
            update: {
              photos: mariaPhotos
            }
          }
        },
        create: {
          email: "maria@swiip.com",
          phone: "+905551234568",
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
              photos: mariaPhotos,
            },
          },
        },
      });
    })(),

    // User 3: John - FREE USER, Near Like Limit, Has Used Ads
    (async () => {
      const johnPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
        "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400",
        "https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "john@swiip.com" },
        update: {
          profile: {
            update: {
              photos: johnPhotos
            }
          }
        },
        create: {
          email: "john@swiip.com",
          phone: "+905551234569",
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
              photos: johnPhotos,
            },
          },
        },
      });
    })(),

    // User 4: Sophie - PREMIUM, Expired Boost, From France
    (async () => {
      const sophiePhotos = await Promise.all([
        "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400",
        "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400",
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "sophie@swiip.com" },
        update: {
          profile: {
            update: {
              photos: sophiePhotos
            }
          }
        },
        create: {
          email: "sophie@swiip.com",
          phone: "+905551234570",
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
              photos: sophiePhotos,
            },
          },
        },
      });
    })(),

    // User 5: David - FREE USER, At Like Limit
    (async () => {
      const davidPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
        "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "david@swiip.com" },
        update: {
          profile: {
            update: {
              photos: davidPhotos
            }
          }
        },
        create: {
          email: "david@swiip.com",
          phone: "+905551234571",
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
              photos: davidPhotos,
            },
          },
        },
      });
    })(),

    // User 6: Lisa - FREE USER, Has Extra Likes from Ads
    (async () => {
      const lisaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
        "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "lisa@swiip.com" },
        update: {
          profile: {
            update: {
              photos: lisaPhotos
            }
          }
        },
        create: {
          email: "lisa@swiip.com",
          phone: "+905551234572",
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
              photos: lisaPhotos,
            },
          },
        },
      });
    })(),

    // User 7: Michael - FREE USER, Blocked by John
    (async () => {
      const michaelPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
        "https://images.unsplash.com/photo-1480455624313-e29b44bbfde1?w=400",
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "michael@swiip.com" },
        update: {
          profile: {
            update: {
              photos: michaelPhotos
            }
          }
        },
        create: {
          email: "michael@swiip.com",
          phone: "+905551234573",
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
              photos: michaelPhotos,
            },
          },
        },
      });
    })(),

    // User 8: Emma - FREE USER, Reported by Sophie
    (async () => {
      const emmaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400",
        "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "emma@swiip.com" },
        update: {
          profile: {
            update: {
              photos: emmaPhotos
            }
          }
        },
        create: {
          email: "emma@swiip.com",
          phone: "+905551234574",
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
              photos: emmaPhotos,
            },
          },
        },
      });
    })(),

    // User 9: Tom - FREE USER, Referred by Alex
    (async () => {
      const tomPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
        "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400",
        "https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "tom@swiip.com" },
        update: {
          profile: {
            update: {
              photos: tomPhotos
            }
          }
        },
        create: {
          email: "tom@swiip.com",
          phone: "+905551234575",
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
              photos: tomPhotos,
            },
          },
        },
      });
    })(),

    // User 10: Sarah - PREMIUM, From UK
    (async () => {
      const sarahPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "sarah@swiip.com" },
        update: {
          profile: {
            update: {
              photos: sarahPhotos
            }
          }
        },
        create: {
          email: "sarah@swiip.com",
          phone: "+905551234576",
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
              photos: sarahPhotos,
            },
          },
        },
      });
    })(),

    // User 11: Lena - German learning Turkish
    (async () => {
      const lenaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
        "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400",
        "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "lena@swiip.com" },
        update: {
          profile: {
            update: {
              photos: lenaPhotos
            }
          }
        },
        create: {
          email: "lena@swiip.com",
          phone: "+905551234577",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 20 * 60 * 1000),
          referralCode: "LENA01",
          dailyLikesUsed: 3,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Lena",
              birthYear: 1996,
              city: "Istanbul",
              country: "DE",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["German", "English"],
              languagesPractice: ["Turkish"],
              purpose: "PRACTICE",
              bio: "German expat working in tech. Love exploring Istanbul's hidden gems!",
              photos: lenaPhotos,
            },
          },
        },
      });
    })(),

    // User 12: Kerem - Turkish learning Spanish
    (async () => {
      const keremPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
        "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "kerem@swiip.com" },
        update: {
          profile: {
            update: {
              photos: keremPhotos
            }
          }
        },
        create: {
          email: "kerem@swiip.com",
          phone: "+905551234578",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 45 * 60 * 1000),
          referralCode: "KEREM1",
          dailyLikesUsed: 7,
          dailyExtraLikesFromAds: 3,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Kerem",
              birthYear: 1994,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Turkish"],
              languagesPractice: ["Spanish", "Portuguese"],
              purpose: "CONVERSATION",
              bio: "Software developer by day, language enthusiast by night. Planning a trip to South America!",
              photos: keremPhotos,
            },
          },
        },
      });
    })(),

    // User 13: Yuki - Japanese learning Turkish
    (async () => {
      const yukiPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",
        "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400",
        "https://images.unsplash.com/photo-1491349174775-aaafddd81942?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "yuki@swiip.com" },
        update: {
          profile: {
            update: {
              photos: yukiPhotos
            }
          }
        },
        create: {
          email: "yuki@swiip.com",
          phone: "+905551234579",
          isPremium: true,
          premiumSource: "revenuecat",
          premiumUpdatedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000),
          lastActiveAt: new Date(now.getTime() - 10 * 60 * 1000),
          referralCode: "YUKI01",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 1,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Yuki",
              birthYear: 1998,
              city: "Istanbul",
              country: "JP",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Japanese", "English"],
              languagesPractice: ["Turkish"],
              purpose: "COFFEE",
              bio: "Japanese food blogger exploring Turkish cuisine. Let's grab coffee and chat!",
              photos: yukiPhotos,
            },
          },
        },
      });
    })(),

    // User 14: Carlos - Spanish learning English
    (async () => {
      const carlosPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
        "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "carlos@swiip.com" },
        update: {
          profile: {
            update: {
              photos: carlosPhotos
            }
          }
        },
        create: {
          email: "carlos@swiip.com",
          phone: "+905551234580",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          referralCode: "CARLO1",
          dailyLikesUsed: 5,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Carlos",
              birthYear: 1991,
              city: "Istanbul",
              country: "ES",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Spanish"],
              languagesPractice: ["English", "Turkish"],
              purpose: "PRACTICE",
              bio: "Spanish architect working on exciting projects in Istanbul. Love history and design!",
              photos: carlosPhotos,
            },
          },
        },
      });
    })(),

    // User 15: Zeynep - Turkish learning French
    (async () => {
      const zeynepPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
        "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "zeynep@swiip.com" },
        update: {
          profile: {
            update: {
              photos: zeynepPhotos
            }
          }
        },
        create: {
          email: "zeynep@swiip.com",
          phone: "+905551234581",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 35 * 60 * 1000),
          referralCode: "ZEYNE1",
          dailyLikesUsed: 2,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Zeynep",
              birthYear: 1999,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Turkish", "English"],
              languagesPractice: ["French"],
              purpose: "CONVERSATION",
              bio: "University student studying literature. Dreaming of Paris! 📚",
              photos: zeynepPhotos,
            },
          },
        },
      });
    })(),

    // User 16: Marco - Italian photographer
    (async () => {
      const marcoPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400",
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
        "https://images.unsplash.com/photo-1480455624313-e29b44bbfde1?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "marco@swiip.com" },
        update: {
          profile: {
            update: {
              photos: marcoPhotos
            }
          }
        },
        create: {
          email: "marco@swiip.com",
          phone: "+905551234582",
          isPremium: true,
          premiumSource: "revenuecat",
          premiumUpdatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
          lastActiveAt: new Date(now.getTime() - 5 * 60 * 1000),
          referralCode: "MARCO1",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 2,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Marco",
              birthYear: 1990,
              city: "Istanbul",
              country: "IT",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Italian", "English"],
              languagesPractice: ["Turkish"],
              purpose: "COFFEE",
              bio: "Photographer capturing the beauty of Istanbul. Always up for coffee and conversation!",
              photos: marcoPhotos,
            },
          },
        },
      });
    })(),

    // User 17: Anna - Russian learning Turkish
    (async () => {
      const annaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
        "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "anna@swiip.com" },
        update: {
          profile: {
            update: {
              photos: annaPhotos
            }
          }
        },
        create: {
          email: "anna@swiip.com",
          phone: "+905551234583",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
          referralCode: "ANNA01",
          dailyLikesUsed: 10,
          dailyExtraLikesFromAds: 6,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Anna",
              birthYear: 1995,
              city: "Istanbul",
              country: "RU",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Russian", "English"],
              languagesPractice: ["Turkish", "Spanish"],
              purpose: "PRACTICE",
              bio: "Marketing specialist. Love traveling and meeting people from different cultures!",
              photos: annaPhotos,
            },
          },
        },
      });
    })(),

    // User 18: Burak - Turkish learning German
    (async () => {
      const burakPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
        "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "burak@swiip.com" },
        update: {
          profile: {
            update: {
              photos: burakPhotos
            }
          }
        },
        create: {
          email: "burak@swiip.com",
          phone: "+905551234584",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 25 * 60 * 1000),
          referralCode: "BURAK1",
          dailyLikesUsed: 4,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Burak",
              birthYear: 1993,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Turkish"],
              languagesPractice: ["German", "English"],
              purpose: "CONVERSATION",
              bio: "Engineer planning to move to Germany. Looking for language partners!",
              photos: burakPhotos,
            },
          },
        },
      });
    })(),

    // User 19: Olivia - British learning Spanish
    (async () => {
      const oliviaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "olivia@swiip.com" },
        update: {
          profile: {
            update: {
              photos: oliviaPhotos
            }
          }
        },
        create: {
          email: "olivia@swiip.com",
          phone: "+905551234585",
          isPremium: true,
          premiumSource: "revenuecat",
          premiumUpdatedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000),
          lastActiveAt: new Date(now.getTime() - 8 * 60 * 1000),
          referralCode: "OLIVI1",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 1,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Olivia",
              birthYear: 1997,
              city: "Ankara",
              country: "GB",
              lat: ANKARA_LAT + (Math.random() - 0.5) * 0.1,
              lng: ANKARA_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["English"],
              languagesPractice: ["Spanish", "Turkish"],
              purpose: "COFFEE",
              bio: "Diplomat in Ankara. Love languages, politics, and good coffee!",
              photos: oliviaPhotos,
            },
          },
        },
      });
    })(),

    // User 20: Ahmet - Turkish learning Japanese
    (async () => {
      const ahmetPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
        "https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "ahmet@swiip.com" },
        update: {
          profile: {
            update: {
              photos: ahmetPhotos
            }
          }
        },
        create: {
          email: "ahmet@swiip.com",
          phone: "+905551234586",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 55 * 60 * 1000),
          referralCode: "AHMET1",
          dailyLikesUsed: 8,
          dailyExtraLikesFromAds: 3,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Ahmet",
              birthYear: 1992,
              city: "Izmir",
              country: "TR",
              lat: IZMIR_LAT + (Math.random() - 0.5) * 0.1,
              lng: IZMIR_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Turkish", "English"],
              languagesPractice: ["Japanese"],
              purpose: "PRACTICE",
              bio: "Anime enthusiast learning Japanese. Yoroshiku onegaishimasu! 🇯🇵",
              photos: ahmetPhotos,
            },
          },
        },
      });
    })(),

    // User 21: Sofia - Brazilian learning Turkish
    (async () => {
      const sofiaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400",
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
        "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "sofia@swiip.com" },
        update: {
          profile: {
            update: {
              photos: sofiaPhotos
            }
          }
        },
        create: {
          email: "sofia@swiip.com",
          phone: "+905551234587",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 15 * 60 * 1000),
          referralCode: "SOFIA1",
          dailyLikesUsed: 6,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Sofia",
              birthYear: 1996,
              city: "Istanbul",
              country: "BR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Portuguese", "Spanish"],
              languagesPractice: ["Turkish", "English"],
              purpose: "CONVERSATION",
              bio: "Brazilian dancer teaching salsa in Istanbul. Let's dance and talk! 💃",
              photos: sofiaPhotos,
            },
          },
        },
      });
    })(),

    // User 22: Mert - Turkish learning Korean
    (async () => {
      const mertPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=400",
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
        "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "mert@swiip.com" },
        update: {
          profile: {
            update: {
              photos: mertPhotos
            }
          }
        },
        create: {
          email: "mert@swiip.com",
          phone: "+905551234588",
          isPremium: true,
          premiumSource: "revenuecat",
          premiumUpdatedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 22 * 24 * 60 * 60 * 1000),
          lastActiveAt: new Date(now.getTime() - 3 * 60 * 1000),
          referralCode: "MERT01",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 3,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Mert",
              birthYear: 2000,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Turkish"],
              languagesPractice: ["Korean", "Japanese"],
              purpose: "PRACTICE",
              bio: "K-pop fan learning Korean. Ask me about BTS! 🎵",
              photos: mertPhotos,
            },
          },
        },
      });
    })(),

    // User 23: Clara - French learning Turkish
    (async () => {
      const claraPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1491349174775-aaafddd81942?w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
        "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "clara@swiip.com" },
        update: {
          profile: {
            update: {
              photos: claraPhotos
            }
          }
        },
        create: {
          email: "clara@swiip.com",
          phone: "+905551234589",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 40 * 60 * 1000),
          referralCode: "CLARA1",
          dailyLikesUsed: 9,
          dailyExtraLikesFromAds: 6,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Clara",
              birthYear: 1994,
              city: "Istanbul",
              country: "FR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["French", "English"],
              languagesPractice: ["Turkish"],
              purpose: "COFFEE",
              bio: "French chef running a bistro in Kadıköy. Love Turkish cuisine!",
              photos: claraPhotos,
            },
          },
        },
      });
    })(),

    // User 24: Can - Turkish learning Chinese
    (async () => {
      const canPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1480455624313-e29b44bbfde1?w=400",
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "can@swiip.com" },
        update: {
          profile: {
            update: {
              photos: canPhotos
            }
          }
        },
        create: {
          email: "can@swiip.com",
          phone: "+905551234590",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 70 * 60 * 1000),
          referralCode: "CAN001",
          dailyLikesUsed: 3,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Can",
              birthYear: 1988,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Turkish", "English"],
              languagesPractice: ["Chinese"],
              purpose: "CONVERSATION",
              bio: "Import/export businessman. Learning Mandarin for work. 你好!",
              photos: canPhotos,
            },
          },
        },
      });
    })(),

    // User 25: Nina - Ukrainian learning Turkish
    (async () => {
      const ninaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400",
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "nina@swiip.com" },
        update: {
          profile: {
            update: {
              photos: ninaPhotos
            }
          }
        },
        create: {
          email: "nina@swiip.com",
          phone: "+905551234591",
          isPremium: true,
          premiumSource: "revenuecat",
          premiumUpdatedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000),
          lastActiveAt: new Date(now.getTime() - 2 * 60 * 1000),
          referralCode: "NINA01",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Nina",
              birthYear: 1997,
              city: "Istanbul",
              country: "UA",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Ukrainian", "Russian", "English"],
              languagesPractice: ["Turkish"],
              purpose: "PRACTICE",
              bio: "UI/UX designer. Love art, design, and learning new languages!",
              photos: ninaPhotos,
            },
          },
        },
      });
    })(),

    // User 26: Deniz - Turkish learning Italian
    (async () => {
      const denizPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "deniz@swiip.com" },
        update: {
          profile: {
            update: {
              photos: denizPhotos
            }
          }
        },
        create: {
          email: "deniz@swiip.com",
          phone: "+905551234592",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 90 * 60 * 1000),
          referralCode: "DENIZ1",
          dailyLikesUsed: 15,
          dailyExtraLikesFromAds: 9,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Deniz",
              birthYear: 1995,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Turkish"],
              languagesPractice: ["Italian", "French"],
              purpose: "CONVERSATION",
              bio: "Fashion designer with an obsession for Italian style. Ciao! 👗",
              photos: denizPhotos,
            },
          },
        },
      });
    })(),

    // User 27: James - American learning Turkish
    (async () => {
      const jamesPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400",
        "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400",
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "james@swiip.com" },
        update: {
          profile: {
            update: {
              photos: jamesPhotos
            }
          }
        },
        create: {
          email: "james@swiip.com",
          phone: "+905551234593",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 120 * 60 * 1000),
          referralCode: "JAMES1",
          dailyLikesUsed: 2,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "James",
              birthYear: 1989,
              city: "Istanbul",
              country: "US",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["English"],
              languagesPractice: ["Turkish"],
              purpose: "COFFEE",
              bio: "American writer working on a novel set in Istanbul. Need local insights!",
              photos: jamesPhotos,
            },
          },
        },
      });
    })(),

    // User 28: Elif - Turkish learning Russian
    (async () => {
      const elifPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
        "https://images.unsplash.com/photo-1491349174775-aaafddd81942?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "elif@swiip.com" },
        update: {
          profile: {
            update: {
              photos: elifPhotos
            }
          }
        },
        create: {
          email: "elif@swiip.com",
          phone: "+905551234594",
          isPremium: true,
          premiumSource: "revenuecat",
          premiumUpdatedAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
          lastActiveAt: new Date(now.getTime() - 5 * 60 * 1000),
          referralCode: "ELIF01",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 2,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Elif",
              birthYear: 1998,
              city: "Ankara",
              country: "TR",
              lat: ANKARA_LAT + (Math.random() - 0.5) * 0.1,
              lng: ANKARA_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Turkish", "English"],
              languagesPractice: ["Russian"],
              purpose: "PRACTICE",
              bio: "International relations student. Studying Russian literature! 📖",
              photos: elifPhotos,
            },
          },
        },
      });
    })(),

    // User 29: Lucas - Dutch learning Turkish
    (async () => {
      const lucasPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=400",
        "https://images.unsplash.com/photo-1480455624313-e29b44bbfde1?w=400",
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "lucas@swiip.com" },
        update: {
          profile: {
            update: {
              photos: lucasPhotos
            }
          }
        },
        create: {
          email: "lucas@swiip.com",
          phone: "+905551234595",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 30 * 60 * 1000),
          referralCode: "LUCAS1",
          dailyLikesUsed: 7,
          dailyExtraLikesFromAds: 3,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Lucas",
              birthYear: 1991,
              city: "Istanbul",
              country: "NL",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Dutch", "English", "German"],
              languagesPractice: ["Turkish"],
              purpose: "CONVERSATION",
              bio: "Dutch entrepreneur. Running a tech startup in Istanbul!",
              photos: lucasPhotos,
            },
          },
        },
      });
    })(),

    // User 30: Selin - Turkish learning English
    (async () => {
      const selinPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400",
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "selin@swiip.com" },
        update: {
          profile: {
            update: {
              photos: selinPhotos
            }
          }
        },
        create: {
          email: "selin@swiip.com",
          phone: "+905551234596",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 12 * 60 * 1000),
          referralCode: "SELIN1",
          dailyLikesUsed: 1,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Selin",
              birthYear: 2001,
              city: "Izmir",
              country: "TR",
              lat: IZMIR_LAT + (Math.random() - 0.5) * 0.1,
              lng: IZMIR_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Turkish"],
              languagesPractice: ["English", "Spanish"],
              purpose: "PRACTICE",
              bio: "Medical student. Want to improve my English for conferences! 🏥",
              photos: selinPhotos,
            },
          },
        },
      });
    })(),

    // User 31: Pierre - French learning Turkish
    (async () => {
      const pierrePhotos = await Promise.all([
        "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400",
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
        "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "pierre@swiip.com" },
        update: {
          profile: {
            update: {
              photos: pierrePhotos
            }
          }
        },
        create: {
          email: "pierre@swiip.com",
          phone: "+905551234597",
          isPremium: true,
          premiumSource: "revenuecat",
          premiumUpdatedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
          lastActiveAt: new Date(now.getTime() - 7 * 60 * 1000),
          referralCode: "PIERR1",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 1,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Pierre",
              birthYear: 1987,
              city: "Istanbul",
              country: "FR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["French"],
              languagesPractice: ["Turkish", "English"],
              purpose: "COFFEE",
              bio: "Wine sommelier exploring Turkish wines. Şerefe! 🍷",
              photos: pierrePhotos,
            },
          },
        },
      });
    })(),

    // User 32: Ece - Turkish learning German
    (async () => {
      const ecePhotos = await Promise.all([
        "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400",
        "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",
        "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "ece@swiip.com" },
        update: {
          profile: {
            update: {
              photos: ecePhotos
            }
          }
        },
        create: {
          email: "ece@swiip.com",
          phone: "+905551234598",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 50 * 60 * 1000),
          referralCode: "ECE001",
          dailyLikesUsed: 11,
          dailyExtraLikesFromAds: 6,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Ece",
              birthYear: 1996,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Turkish", "English"],
              languagesPractice: ["German"],
              purpose: "CONVERSATION",
              bio: "Architect dreaming of working in Berlin. Ich liebe Architektur! 🏛️",
              photos: ecePhotos,
            },
          },
        },
      });
    })(),

    // User 33: Ivan - Bulgarian learning Turkish
    (async () => {
      const ivanPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
        "https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=400",
        "https://images.unsplash.com/photo-1480455624313-e29b44bbfde1?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "ivan@swiip.com" },
        update: {
          profile: {
            update: {
              photos: ivanPhotos
            }
          }
        },
        create: {
          email: "ivan@swiip.com",
          phone: "+905551234599",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 80 * 60 * 1000),
          referralCode: "IVAN01",
          dailyLikesUsed: 4,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Ivan",
              birthYear: 1990,
              city: "Istanbul",
              country: "BG",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Bulgarian", "English"],
              languagesPractice: ["Turkish"],
              purpose: "PRACTICE",
              bio: "Musician from Sofia. Love Turkish music and want to collaborate!",
              photos: ivanPhotos,
            },
          },
        },
      });
    })(),

    // User 34: Aylin - Turkish learning Portuguese
    (async () => {
      const aylinPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
        "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400",
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "aylin@swiip.com" },
        update: {
          profile: {
            update: {
              photos: aylinPhotos
            }
          }
        },
        create: {
          email: "aylin@swiip.com",
          phone: "+905551234600",
          isPremium: true,
          premiumSource: "revenuecat",
          premiumUpdatedAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 18 * 24 * 60 * 60 * 1000),
          lastActiveAt: new Date(now.getTime() - 4 * 60 * 1000),
          referralCode: "AYLIN1",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 4,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Aylin",
              birthYear: 1993,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Turkish"],
              languagesPractice: ["Portuguese", "Spanish"],
              purpose: "COFFEE",
              bio: "Marketing manager planning a sabbatical in Brazil. Olá! 🌴",
              photos: aylinPhotos,
            },
          },
        },
      });
    })(),

    // User 35: Okan - Turkish learning Arabic
    (async () => {
      const okanPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
        "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400",
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "okan@swiip.com" },
        update: {
          profile: {
            update: {
              photos: okanPhotos
            }
          }
        },
        create: {
          email: "okan@swiip.com",
          phone: "+905551234601",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 65 * 60 * 1000),
          referralCode: "OKAN01",
          dailyLikesUsed: 6,
          dailyExtraLikesFromAds: 3,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Okan",
              birthYear: 1985,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Turkish", "English"],
              languagesPractice: ["Arabic"],
              purpose: "CONVERSATION",
              bio: "History professor interested in Middle Eastern studies. مرحبا!",
              photos: okanPhotos,
            },
          },
        },
      });
    })(),

    // User 36: Hana - Korean learning Turkish
    (async () => {
      const hanaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400",
        "https://images.unsplash.com/photo-1491349174775-aaafddd81942?w=400",
        "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "hana@swiip.com" },
        update: {
          profile: {
            update: {
              photos: hanaPhotos
            }
          }
        },
        create: {
          email: "hana@swiip.com",
          phone: "+905551234602",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 18 * 60 * 1000),
          referralCode: "HANA01",
          dailyLikesUsed: 8,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Hana",
              birthYear: 1999,
              city: "Istanbul",
              country: "KR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Korean", "English"],
              languagesPractice: ["Turkish"],
              purpose: "PRACTICE",
              bio: "Korean exchange student at Boğaziçi University. Merhaba! 안녕!",
              photos: hanaPhotos,
            },
          },
        },
      });
    })(),

    // User 37: Ali - Turkish learning English
    (async () => {
      const aliPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
        "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "ali@swiip.com" },
        update: {
          profile: {
            update: {
              photos: aliPhotos
            }
          }
        },
        create: {
          email: "ali@swiip.com",
          phone: "+905551234603",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 95 * 60 * 1000),
          referralCode: "ALI001",
          dailyLikesUsed: 13,
          dailyExtraLikesFromAds: 9,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Ali",
              birthYear: 1994,
              city: "Ankara",
              country: "TR",
              lat: ANKARA_LAT + (Math.random() - 0.5) * 0.1,
              lng: ANKARA_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Turkish"],
              languagesPractice: ["English"],
              purpose: "PRACTICE",
              bio: "Gym instructor. Healthy life, healthy mind. 💪",
              photos: aliPhotos,
            },
          },
        },
      });
    })(),

    // User 38: Eva - Swedish learning Turkish
    (async () => {
      const evaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
        "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "eva@swiip.com" },
        update: {
          profile: {
            update: {
              photos: evaPhotos
            }
          }
        },
        create: {
          email: "eva@swiip.com",
          phone: "+905551234604",
          isPremium: true,
          premiumSource: "revenuecat",
          premiumUpdatedAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 24 * 24 * 60 * 60 * 1000),
          lastActiveAt: new Date(now.getTime() - 6 * 60 * 1000),
          referralCode: "EVA001",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 2,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Eva",
              birthYear: 1992,
              city: "Istanbul",
              country: "SE",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Swedish", "English"],
              languagesPractice: ["Turkish"],
              purpose: "COFFEE",
              bio: "Swedish journalist covering Turkey. Fika anyone? ☕",
              photos: evaPhotos,
            },
          },
        },
      });
    })(),

    // User 39: Emre - Turkish learning Greek
    (async () => {
      const emrePhotos = await Promise.all([
        "https://images.unsplash.com/photo-1480455624313-e29b44bbfde1?w=400",
        "https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=400",
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "emre@swiip.com" },
        update: {
          profile: {
            update: {
              photos: emrePhotos
            }
          }
        },
        create: {
          email: "emre@swiip.com",
          phone: "+905551234605",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 42 * 60 * 1000),
          referralCode: "EMRE01",
          dailyLikesUsed: 5,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Emre",
              birthYear: 1988,
              city: "Izmir",
              country: "TR",
              lat: IZMIR_LAT + (Math.random() - 0.5) * 0.1,
              lng: IZMIR_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Turkish", "English"],
              languagesPractice: ["Greek"],
              purpose: "CONVERSATION",
              bio: "Aegean tour guide. Love Greek culture and islands! Γεια σου!",
              photos: emrePhotos,
            },
          },
        },
      });
    })(),

    // User 40: Maya - Indian learning Turkish
    (async () => {
      const mayaPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
        "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "maya@swiip.com" },
        update: {
          profile: {
            update: {
              photos: mayaPhotos
            }
          }
        },
        create: {
          email: "maya@swiip.com",
          phone: "+905551234606",
          isPremium: false,
          lastActiveAt: new Date(now.getTime() - 22 * 60 * 1000),
          referralCode: "MAYA01",
          dailyLikesUsed: 9,
          dailyExtraLikesFromAds: 3,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Maya",
              birthYear: 1997,
              city: "Istanbul",
              country: "IN",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "FEMALE",
              languagesNative: ["Hindi", "English"],
              languagesPractice: ["Turkish"],
              purpose: "PRACTICE",
              bio: "Bollywood dancer teaching in Istanbul. Namaste! 🙏",
              photos: mayaPhotos,
            },
          },
        },
      });
    })(),

    // User 41: Test - PREMIUM test account
    (async () => {
      const testPhotos = await Promise.all([
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
        "https://images.unsplash.com/photo-1480455624313-e29b44bbfde1?w=400",
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
      ].map(uploadFromUrl));

      return prisma.user.upsert({
        where: { email: "test@swiip.com" },
        update: {
          profile: {
            update: {
              photos: testPhotos,
            }
          }
        },
        create: {
          email: "test@swiip.com",
          phone: "+905551234607",
          isPremium: true,
          premiumSource: "admin",
          premiumUpdatedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          premiumExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          lastActiveAt: now,
          referralCode: "TEST01",
          dailyLikesUsed: 0,
          dailyExtraLikesFromAds: 0,
          lastLikeResetAt: now,
          dailyDirectUsed: 0,
          lastDirectResetAt: now,
          profile: {
            create: {
              displayName: "Test User",
              birthYear: 1995,
              city: "Istanbul",
              country: "TR",
              lat: ISTANBUL_LAT + (Math.random() - 0.5) * 0.1,
              lng: ISTANBUL_LNG + (Math.random() - 0.5) * 0.1,
              gender: "MALE",
              languagesNative: ["Turkish", "English"],
              languagesPractice: ["Spanish", "French"],
              purpose: "CONVERSATION",
              bio: "Test account for development and testing purposes.",
              photos: testPhotos,
            },
          },
        },
      });
    })(),
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
  const testUser = users.find(u => u.email === "test@swiip.com") || users[0]; // Test user or fallback to Alex
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

  // Add more likes for comprehensive testing - Every user gets several incoming likes
  console.log("💕 Adding more likes for testing...");

  // Likes for Alex (users[0])
  await prisma.conversationRequest.create({
    data: { fromUserId: users[2].id, toUserId: users[0].id, status: "PENDING", kind: "LIKE" },
  });

  // Likes for Maria (users[1])
  await prisma.conversationRequest.create({
    data: { fromUserId: users[3].id, toUserId: users[1].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[7].id, toUserId: users[1].id, status: "PENDING", kind: "LIKE" },
  });

  // Likes for John (users[2])
  await prisma.conversationRequest.create({
    data: { fromUserId: users[5].id, toUserId: users[2].id, status: "PENDING", kind: "LIKE" },
  });
  // Note: users[2] -> users[7] already exists as FAVORITE, but LIKE is different, so skip Emma
  await prisma.conversationRequest.create({
    data: { fromUserId: users[9].id, toUserId: users[2].id, status: "PENDING", kind: "LIKE" },
  });

  // Likes for Sophie (users[3])
  // Note: users[0] -> users[3] already exists (line 515), skip it
  await prisma.conversationRequest.create({
    data: { fromUserId: users[2].id, toUserId: users[3].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[4].id, toUserId: users[3].id, status: "PENDING", kind: "LIKE" },
  });
  // Note: users[3] -> users[8] will be created as FAVORITE below, skip LIKE

  // Likes for David (users[4])
  await prisma.conversationRequest.create({
    data: { fromUserId: users[1].id, toUserId: users[4].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[5].id, toUserId: users[4].id, status: "PENDING", kind: "LIKE" },
  });

  // Likes for Lisa (users[5])
  await prisma.conversationRequest.create({
    data: { fromUserId: users[0].id, toUserId: users[5].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[3].id, toUserId: users[5].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[4].id, toUserId: users[5].id, status: "PENDING", kind: "LIKE" },
  });

  // Likes for Michael (users[6])
  await prisma.conversationRequest.create({
    data: { fromUserId: users[1].id, toUserId: users[6].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[5].id, toUserId: users[6].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[8].id, toUserId: users[6].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[9].id, toUserId: users[6].id, status: "PENDING", kind: "LIKE" },
  });

  // Likes for Emma (users[7])
  // Note: users[2] -> users[7] already exists as FAVORITE (John -> Emma)
  await prisma.conversationRequest.create({
    data: { fromUserId: users[0].id, toUserId: users[7].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[3].id, toUserId: users[7].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[4].id, toUserId: users[7].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[6].id, toUserId: users[7].id, status: "PENDING", kind: "LIKE" },
  });

  // Likes for Tom (users[8])
  await prisma.conversationRequest.create({
    data: { fromUserId: users[1].id, toUserId: users[8].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[5].id, toUserId: users[8].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[7].id, toUserId: users[8].id, status: "PENDING", kind: "LIKE" },
  });

  // Likes for Sarah (users[9])
  await prisma.conversationRequest.create({
    data: { fromUserId: users[2].id, toUserId: users[9].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[3].id, toUserId: users[9].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[4].id, toUserId: users[9].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[6].id, toUserId: users[9].id, status: "PENDING", kind: "LIKE" },
  });
  await prisma.conversationRequest.create({
    data: { fromUserId: users[8].id, toUserId: users[9].id, status: "PENDING", kind: "LIKE" },
  });

  // Add some FAVORITE requests (direct messages) for testing
  // Sophie sends FAVORITE to Tom
  const sophieFavoritesTom = await prisma.conversationRequest.create({
    data: { fromUserId: users[3].id, toUserId: users[8].id, status: "PENDING", kind: "FAVORITE" },
  });
  const sophieTomMessage = await prisma.message.create({
    data: {
      senderUserId: users[3].id,
      text: "Hi Tom! I saw you're new to Istanbul. Would you like to meet for coffee and practice languages together?",
      isRequestMessage: true,
      requestId: sophieFavoritesTom.id,
    },
  });
  await prisma.conversationRequest.update({
    where: { id: sophieFavoritesTom.id },
    data: { firstMessageId: sophieTomMessage.id },
  });

  // Maria sends FAVORITE to Sophie
  const mariaFavoritesSophie = await prisma.conversationRequest.create({
    data: { fromUserId: users[1].id, toUserId: users[3].id, status: "PENDING", kind: "FAVORITE" },
  });
  const mariaSophieMessage = await prisma.message.create({
    data: {
      senderUserId: users[1].id,
      text: "Merhaba Sophie! French ve Turkish practice yapmak ister misin? Ben İstanbul'dayım, bir gün buluşabiliriz!",
      isRequestMessage: true,
      requestId: mariaFavoritesSophie.id,
    },
  });
  await prisma.conversationRequest.update({
    where: { id: mariaFavoritesSophie.id },
    data: { firstMessageId: mariaSophieMessage.id },
  });

  // Sarah sends FAVORITE to David
  const sarahFavoritesDavid = await prisma.conversationRequest.create({
    data: { fromUserId: users[9].id, toUserId: users[4].id, status: "PENDING", kind: "FAVORITE" },
  });
  const sarahDavidMessage = await prisma.message.create({
    data: {
      senderUserId: users[9].id,
      text: "Hey David! I'm looking for someone to practice Turkish with. Would you be interested in a language exchange?",
      isRequestMessage: true,
      requestId: sarahFavoritesDavid.id,
    },
  });
  await prisma.conversationRequest.update({
    where: { id: sarahFavoritesDavid.id },
    data: { firstMessageId: sarahDavidMessage.id },
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
  console.log(`Phone: +905551234607`);
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
