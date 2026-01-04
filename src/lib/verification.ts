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

import nodemailer from "nodemailer";
import { getEnv } from "./env.js";

// Create reusable transporter object using the default SMTP transport
const createTransporter = () => {
  const env = getEnv();
  if (!env.SMTP_USER || !env.SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465, // true for 465, false for other ports
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
};

/**
 * Send verification code (Integrates with Nodemailer)
 */
export async function sendVerificationCode(
  email: string | null,
  phone: string | null,
  code: string
): Promise<void> {
  const env = getEnv();

  if (email) {
    console.log(`📧 Verification code for ${email}: ${code}`);

    // Send real email if SMTP is configured
    const transporter = createTransporter();
    if (transporter) {
      try {
        await transporter.sendMail({
          from: env.SMTP_FROM,
          to: email,
          subject: "Your Verification Code - Swiip",
          text: `Your Swiip verification code is: ${code}\n\nIt expires in 5 minutes.`,
          html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #6C5CE7;">Swiip Verification</h2>
                        <p>Your verification code is:</p>
                        <h1 style="font-size: 32px; letter-spacing: 5px; color: #333;">${code}</h1>
                        <p>This code will expire in 5 minutes.</p>
                        <p style="font-size: 12px; color: #999; margin-top: 20px;">If you didn't request this code, you can ignore this email.</p>
                    </div>
                `
        });
        console.log(`✅ Email sent successfully to ${email}`);
      } catch (error) {
        console.error("❌ Failed to send email:", error);
      }
    }

  } else if (phone) {
    console.log(`📱 Verification code for ${phone}: ${code}`);
    // TODO: Send SMS via service (Twilio, AWS SNS, etc.)
  }
}


