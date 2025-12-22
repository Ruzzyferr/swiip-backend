import { Router } from "express";
import authRoutes from "../../modules/auth/routes.js";
import profilesRoutes from "../../modules/profiles/routes.js";
import discoveryRoutes from "../../modules/discovery/routes.js";
import matchesRoutes from "../../modules/matches/routes.js";
import chatRoutes from "../../modules/chat/routes.js";
import aiRoutes from "../../modules/ai/routes.js";
import likesRoutes from "../../modules/likes/routes.js";
import boostRoutes from "../../modules/boost/routes.js";
import safetyRoutes from "../../modules/safety/routes.js";
import adminRoutes from "../../modules/admin/routes.js";
import billingRoutes from "../../modules/billing/routes.js";
import notificationsRoutes from "../../modules/notifications/routes.js";
import referralRoutes from "../../modules/referral/routes.js";
import webhooksRoutes from "../../modules/webhooks/routes.js";
import rewardsRoutes from "../../modules/rewards/routes.js";
import healthRoutes from "../health.js";

const router = Router();

// Health check under v1
router.use("/health", healthRoutes);

// Module routes
router.use("/auth", authRoutes);
router.use("/profiles", profilesRoutes);
router.use("/discovery", discoveryRoutes);
router.use("/matches", matchesRoutes);
router.use("/chat", chatRoutes);
router.use("/ai", aiRoutes);
router.use("/likes", likesRoutes);
router.use("/boost", boostRoutes);
router.use("/safety", safetyRoutes);
router.use("/admin", adminRoutes);
router.use("/billing", billingRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/referral", referralRoutes);
router.use("/webhooks", webhooksRoutes);
router.use("/rewards", rewardsRoutes);

export default router;

