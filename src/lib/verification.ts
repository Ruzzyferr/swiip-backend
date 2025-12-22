import { prisma } from "./prisma.js";

/**
 * Generate a 6-digit verification code
 */
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Create a verification code for a user
 */
export async function createVerificationCode(
  userId: string,
  type: "EMAIL" | "PHONE"
): Promise<string> {
  const code = generateVerificationCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 5); // 5 minutes expiry

  // Invalidate any existing unused codes for this user
  await (prisma as any).verificationCode.updateMany({
    where: {
      userId,
      used: false,
      expiresAt: {
        gt: new Date(),
      },
    },
    data: {
      used: true,
    },
  });

  // Create new code
  await (prisma as any).verificationCode.create({
    data: {
      userId,
      code,
      type,
      expiresAt,
    },
  });

  return code;
}

/**
 * Verify a code for a user
 */
export async function verifyCode(
  userId: string,
  code: string
): Promise<boolean> {
  const verification = await (prisma as any).verificationCode.findFirst({
    where: {
      userId,
      code,
      used: false,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  if (!verification) {
    return false;
  }

  // Mark as used
  await (prisma as any).verificationCode.update({
    where: { id: verification.id },
    data: { used: true },
  });

  return true;
}

/**
 * Send verification code (mock implementation - in production use email/SMS service)
 */
export async function sendVerificationCode(
  email: string | null,
  phone: string | null,
  code: string
): Promise<void> {
  // In development, just log the code
  // In production, integrate with email/SMS service
  if (email) {
    console.log(`📧 Verification code for ${email}: ${code}`);
    // TODO: Send email via service (SendGrid, AWS SES, etc.)
  } else if (phone) {
    console.log(`📱 Verification code for ${phone}: ${code}`);
    // TODO: Send SMS via service (Twilio, AWS SNS, etc.)
  }
}


