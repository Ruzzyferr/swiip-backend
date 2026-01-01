import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getEnv } from "./env.js";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import { logger } from "./logger.js";

const env = getEnv();

// Initialize S3 Client
// For MinIO, we need forcePathStyle: true
// For AWS S3, it's optional but usually false (virtual hosted buckets)
const s3Client = new S3Client({
    region: env.S3_REGION || "us-east-1",
    endpoint: env.S3_ENDPOINT, // e.g., "https://play.min.io" or undefined for AWS
    forcePathStyle: !!env.S3_ENDPOINT, // True if using MinIO or custom endpoint
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY || "",
        secretAccessKey: env.S3_SECRET_KEY || "",
    },
});

export class StorageService {
    /**
     * Uploads a file to storage (S3/MinIO or Local Fallback)
     * @param file - Multer file object
     * @param folder - Destination folder (e.g., "profiles", "chat")
     * @returns Public URL of the uploaded file
     */
    static async uploadFile(file: Express.Multer.File, folder: string = "uploads"): Promise<string> {
        const fileExtension = path.extname(file.originalname);
        const fileName = `${folder}/${uuidv4()}${fileExtension}`;

        // CHECK: If S3 config is missing, fallback to local (dev mode only)
        if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
            return this.uploadLocal(file, fileName);
        }

        try {
            const command = new PutObjectCommand({
                Bucket: env.S3_BUCKET,
                Key: fileName,
                Body: file.buffer,
                ContentType: file.mimetype,
                // ACL: "public-read", // Optional: depending on bucket poicy
            });

            await s3Client.send(command);

            // Construct Public URL
            // If Custom Endpoint (MinIO/R2): https://endpoint/bucket/key
            // If AWS: https://bucket.s3.region.amazonaws.com/key
            let publicUrl = "";

            if (env.S3_PUBLIC_URL) {
                // Use explicitly provided public URL base (e.g. Cloudflare custom domain)
                publicUrl = `${env.S3_PUBLIC_URL}/${fileName}`;
            } else if (env.S3_ENDPOINT) {
                // MinIO / R2 style
                publicUrl = `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${fileName}`;
            } else {
                // AWS Standard
                publicUrl = `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${fileName}`;
            }

            logger.info(`File uploaded to S3: ${publicUrl}`);
            return publicUrl;
        } catch (error) {
            logger.error("S3 Upload Error", error);
            throw new Error("File upload failed");
        }
    }

    /**
     * Fallback for local development if S3 is not configured
     */
    private static async uploadLocal(file: Express.Multer.File, fileName: string): Promise<string> {
        logger.warn("S3 not configured. Falling back to local storage.");

        // Ensure "uploads" directory exists
        const localUploadDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(path.dirname(path.join(localUploadDir, fileName)), { recursive: true });

        const filePath = path.join(localUploadDir, fileName);

        // Write buffer to file
        await fs.writeFile(filePath, file.buffer);

        // Return relative URL (served by express.static)
        // NOTE: fileName contains the folder (e.g., "profiles/xyz.jpg")
        // We assume app.use("/uploads", express.static(...)) serves from the root "uploads" dir
        return `/uploads/${fileName}`;
    }
}
