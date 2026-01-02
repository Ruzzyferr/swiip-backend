import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
     * @param folder - Destination folder (e.g., "profiles", "audio")
     * @param options - Optional metadata and other options
     * @returns Public URL of the uploaded file
     */
    static async uploadFile(
        file: Express.Multer.File, 
        folder: string = "uploads",
        options?: { metadata?: Record<string, string> }
    ): Promise<string> {
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
                Metadata: options?.metadata || {},
                // ACL: "public-read", // Optional: depending on bucket policy
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
     * Generates a presigned URL for accessing a private S3/MinIO object
     * @param url - The stored URL (can be full URL or just the key path)
     * @param expiresIn - URL expiration time in seconds (default: 1 hour)
     * @returns Presigned URL that allows temporary access to the object
     */
    static async getPresignedUrl(url: string, expiresIn: number = 3600): Promise<string> {
        // If S3 is not configured, return original URL
        if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
            return url;
        }

        try {
            // Extract the key from the URL
            // URLs can be in formats:
            // - https://endpoint/bucket/profiles/uuid.jpg (MinIO with forcePathStyle)
            // - https://bucket.endpoint/profiles/uuid.jpg (MinIO virtual hosted)
            // - /uploads/profiles/uuid.jpg (local fallback)
            // - profiles/uuid.jpg (just the key)
            let key = url;

            // If it's a full URL, extract the key part
            if (url.startsWith("http://") || url.startsWith("https://")) {
                try {
                    const urlObj = new URL(url);
                    const pathParts = urlObj.pathname.split("/").filter(p => p);
                    
                    // For MinIO with forcePathStyle: https://endpoint/bucket/key
                    // For MinIO virtual hosted: https://bucket.endpoint/key
                    // Check if bucket name is in the path
                    const bucketIndex = pathParts.indexOf(env.S3_BUCKET);
                    if (bucketIndex >= 0 && bucketIndex < pathParts.length - 1) {
                        // Bucket found in path, everything after it is the key
                        key = pathParts.slice(bucketIndex + 1).join("/");
                    } else {
                        // Bucket not in path, might be virtual hosted or the path is the key
                        // Try to detect: if path starts with known folders (profiles, audio, chat, etc.)
                        if (pathParts.length > 0 && (pathParts[0] === "profiles" || pathParts[0] === "audio" || pathParts[0] === "chat" || pathParts[0] === "uploads")) {
                            key = pathParts.join("/");
                        } else {
                            // Assume everything after the first slash is the key
                            key = pathParts.join("/") || pathParts[0] || "";
                        }
                    }
                } catch (urlError) {
                    // If URL parsing fails, try to extract key manually
                    logger.warn("Failed to parse URL, trying manual extraction", { url });
                    // Try to find the key pattern (profiles/, audio/, chat/, uploads/)
                    const keyMatch = url.match(/\/(profiles|audio|chat|uploads)\/.+/);
                    if (keyMatch) {
                        key = url.substring(url.indexOf(keyMatch[0]) + 1); // Remove leading slash
                    } else {
                        // Last resort: use the entire path
                        const pathMatch = url.match(/https?:\/\/[^\/]+(\/.+)/);
                        key = pathMatch ? pathMatch[1].substring(1) : url;
                    }
                }
            } else if (url.startsWith("/uploads/")) {
                // Local fallback URL format
                key = url.replace("/uploads/", "");
            } else if (url.startsWith("/")) {
                // Remove leading slash
                key = url.substring(1);
            }

            // Validate key is not empty
            if (!key || key.trim() === "") {
                logger.warn("Empty key extracted from URL, returning original", { url });
                return url;
            }

            // Generate presigned URL
            const command = new GetObjectCommand({
                Bucket: env.S3_BUCKET,
                Key: key,
            });

            const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
            logger.debug(`Generated presigned URL for key: ${key}`);
            return presignedUrl;
        } catch (error) {
            logger.error("Error generating presigned URL", { url, error });
            // Fallback to original URL if presigning fails
            return url;
        }
    }

    /**
     * Transforms an array of photo URLs to presigned URLs
     * @param photoUrls - Array of photo URLs
     * @param expiresIn - URL expiration time in seconds (default: 1 hour)
     * @returns Array of presigned URLs
     */
    static async transformPhotoUrls(photoUrls: string[], expiresIn: number = 3600): Promise<string[]> {
        if (!photoUrls || photoUrls.length === 0) {
            return [];
        }

        // If S3 is not configured, return original URLs
        if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
            return photoUrls;
        }

        // Transform all URLs in parallel
        return Promise.all(
            photoUrls.map(url => this.getPresignedUrl(url, expiresIn))
        );
    }

    /**
     * Transforms a single audio URL to presigned URL
     * @param audioUrl - Audio URL (can be null)
     * @param expiresIn - URL expiration time in seconds (default: 1 hour)
     * @returns Presigned URL or null
     */
    static async transformAudioUrl(audioUrl: string | null, expiresIn: number = 3600): Promise<string | null> {
        if (!audioUrl) {
            return null;
        }

        // If S3 is not configured, return original URL
        if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
            return audioUrl;
        }

        return this.getPresignedUrl(audioUrl, expiresIn);
    }

    /**
     * Transforms an array of audio URLs to presigned URLs
     * @param audioUrls - Array of audio URLs (can contain null values)
     * @param expiresIn - URL expiration time in seconds (default: 1 hour)
     * @returns Array of presigned URLs (null values preserved)
     */
    static async transformAudioUrls(audioUrls: (string | null)[], expiresIn: number = 3600): Promise<(string | null)[]> {
        if (!audioUrls || audioUrls.length === 0) {
            return [];
        }

        // If S3 is not configured, return original URLs
        if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
            return audioUrls;
        }

        // Transform all URLs in parallel (preserve null values)
        return Promise.all(
            audioUrls.map(url => this.transformAudioUrl(url, expiresIn))
        );
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
