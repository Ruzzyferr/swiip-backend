import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../../middleware/auth.js";
import { StorageService } from "../../lib/storage.js";
import { BadRequestError } from "../../lib/httpErrors.js";

const router = Router();

// Configure Multer to store in memory (so we can pass buffer to S3)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new BadRequestError("Only image files are allowed"));
        }
    },
});

/**
 * POST /api/v1/storage/upload
 * Upload a single file (image)
 */
router.post("/upload", authMiddleware, upload.single("photo"), async (req, res, next) => {
    try {
        if (!req.file) {
            throw new BadRequestError("No file uploaded");
        }

        const start = Date.now();
        const url = await StorageService.uploadFile(req.file, "profiles");
        const duration = Date.now() - start;

        res.json({
            success: true,
            url,
            duration: `${duration}ms`
        });
    } catch (error) {
        next(error);
    }
});

export default router;
