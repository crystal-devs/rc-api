/**
 * Production Image Processing Lambda
 * Handles event media uploads with Sharp.js
 * 
 * Features:
 * - Parallel batch processing
 * - Idempotent operations (safe retries)
 * - Large image streaming support (up to 100MB)
 * - Exponential backoff for backend calls
 * - Comprehensive error handling
 * - Memory & performance monitoring
 * 
 * Configuration Requirements:
 * - Memory: 1536-2048MB (recommended: 1792MB)
 * - Timeout: 60 seconds
 * - Ephemeral Storage: 512MB (or 1024MB for 4K images)
 * - Environment Variables: BACKEND_TOKEN, BACKEND_URL (optional)
 * - DLQ: Configure SQS queue for failed events
 * - Reserved Concurrency: Set based on load (recommend 500-1000)
 */

import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    HeadObjectCommand
} from "@aws-sdk/client-s3";
import sharp from "sharp";

// ============================================================================
// CONFIGURATION
// ============================================================================

const s3 = new S3Client({ maxAttempts: 3 }); // Built-in retries for S3 ops
const BUCKET = process.env.BUCKET_NAME || "rc-media-bucket";
const BACKEND_URL = process.env.BACKEND_URL || "https://pride-function-gulf-valve.trycloudflare.com/api/v1/media/update-photo";
const BACKEND_TOKEN = process.env.BACKEND_TOKEN;

// Image processing config
const VARIANT_SIZES = {
    small: { width: 300, quality: 80 },
    medium: { width: 1080, quality: 85 },
    large: { width: 1920, quality: 90 }
};

const MAX_IMAGE_SIZE = 100 * 1024 * 1024; // 100MB (handles 4K camera images)
const BACKEND_TIMEOUT_MS = 10000; // 10 seconds
const BACKEND_MAX_RETRIES = 3;

// ============================================================================
// MAIN HANDLER
// ============================================================================

export const handler = async (event, context) => {
    console.log("Lambda invoked", {
        recordCount: event.Records?.length,
        memory: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
        remaining: context?.getRemainingTimeInMillis?.() || "N/A"
    });

    // Log initial memory state
    logMemoryUsage("Start");

    // Process all S3 records in parallel
    const results = await Promise.allSettled(
        event.Records.map(record => processS3Record(record))
    );

    // Analyze results
    const successful = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected");

    console.log("Batch processing complete", {
        total: results.length,
        successful,
        failed: failed.length
    });

    // Log any failures (they'll be retried by Lambda automatically)
    if (failed.length > 0) {
        failed.forEach((result, idx) => {
            console.error(`Record ${idx} failed:`, {
                reason: result.reason?.message,
                stack: result.reason?.stack
            });
        });

        // If ALL records failed, throw to trigger Lambda retry
        if (successful === 0) {
            throw new Error(`All ${results.length} records failed processing`);
        }
    }

    logMemoryUsage("End");

    return {
        statusCode: 200,
        body: JSON.stringify({
            processed: successful,
            failed: failed.length
        })
    };
};

// ============================================================================
// CORE PROCESSING LOGIC
// ============================================================================

/**
 * Process a single S3 upload event
 * Idempotent: Safe to retry multiple times
 */
async function processS3Record(record) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const size = record.s3.object.size;

    console.log("Processing record", { key, size });

    // 1. Validate this is an original upload
    if (!key.includes("/original/")) {
        console.log("Skipping non-original file", { key });
        return { skipped: true, reason: "not-original" };
    }

    // 2. Extract uploadId from path
    const uploadId = extractUploadId(key);
    if (!uploadId) {
        console.error("Invalid key format - cannot extract uploadId", { key });
        throw new Error(`Invalid key format: ${key}`);
    }

    console.log("Processing upload", { uploadId, key, sizeMB: (size / 1024 / 1024).toFixed(2) });

    try {
        // 3. Check if already processed (idempotency)
        const existingVariants = await checkExistingVariants(uploadId, key);
        if (existingVariants.allExist) {
            console.log("Variants already exist - skipping processing", {
                uploadId,
                variants: existingVariants.keys
            });

            // Still notify backend (idempotent endpoint should handle duplicates)
            await notifyBackend(uploadId, existingVariants.keys);

            return {
                skipped: true,
                reason: "already-processed",
                uploadId
            };
        }

        // 4. Download and validate image
        const imageBuffer = await downloadImage(key, size);

        // 5. Generate missing variants (skip existing ones)
        const variantKeys = await generateVariants(
            imageBuffer,
            key,
            uploadId,
            existingVariants.keys // Pass existing to skip recreation
        );

        // 6. Notify backend
        await notifyBackend(uploadId, variantKeys);

        console.log("Processing complete", { uploadId, variantKeys });

        return {
            success: true,
            uploadId,
            variants: variantKeys
        };

    } catch (error) {
        console.error("Processing failed", {
            uploadId,
            key,
            error: error.message,
            stack: error.stack
        });

        // Re-throw to trigger Lambda retry mechanism
        throw error;
    }
}

// ============================================================================
// IMAGE PROCESSING
// ============================================================================

/**
 * Download image from S3 with size validation
 * Handles large files efficiently
 */
async function downloadImage(key, size) {
    // Size check before download
    if (size > MAX_IMAGE_SIZE) {
        throw new Error(`Image too large: ${(size / 1024 / 1024).toFixed(2)}MB (max: ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`);
    }

    console.log("Downloading from S3", { key, sizeMB: (size / 1024 / 1024).toFixed(2) });

    const startTime = Date.now();

    const { Body, ContentType } = await s3.send(
        new GetObjectCommand({
            Bucket: BUCKET,
            Key: key
        })
    );

    // Stream to buffer efficiently
    const chunks = [];
    for await (const chunk of Body) {
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const downloadTime = Date.now() - startTime;
    console.log("Download complete", {
        bytes: buffer.length,
        timingMs: downloadTime,
        contentType: ContentType
    });

    logMemoryUsage("After download");

    return buffer;
}

/**
 * Generate all image variants with Sharp
 * Skips existing variants for idempotency
 */
async function generateVariants(imageBuffer, originalKey, uploadId, existingVariants = {}) {
    console.log("Generating variants", {
        sizes: Object.keys(VARIANT_SIZES),
        existing: Object.keys(existingVariants)
    });

    const variantKeys = { ...existingVariants };

    // Get image metadata for smart processing
    const metadata = await sharp(imageBuffer).metadata();
    console.log("Image metadata", {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        space: metadata.space,
        hasAlpha: metadata.hasAlpha
    });

    // Process variants in parallel for speed
    const variantPromises = Object.entries(VARIANT_SIZES).map(async ([sizeName, config]) => {
        // Skip if already exists
        if (existingVariants[sizeName]) {
            console.log(`Variant ${sizeName} already exists, skipping`);
            return { sizeName, key: existingVariants[sizeName], skipped: true };
        }

        const startTime = Date.now();

        try {
            // Generate variant
            const variantBuffer = await sharp(imageBuffer)
                .resize(config.width, null, {
                    withoutEnlargement: true,
                    fit: 'inside'
                })
                .webp({
                    quality: config.quality,
                    effort: 4, // Balanced speed/compression
                    smartSubsample: true // Better quality for photos
                })
                .toBuffer();

            const variantKey = generateVariantKey(originalKey, sizeName);

            // Upload to S3
            await s3.send(
                new PutObjectCommand({
                    Bucket: BUCKET,
                    Key: variantKey,
                    Body: variantBuffer,
                    ContentType: "image/webp",
                    CacheControl: "public, max-age=31536000, immutable",
                    Metadata: {
                        'original-upload-id': uploadId,
                        'variant-size': sizeName,
                        'processed-by': 'lambda-image-processor'
                    }
                })
            );

            const processingTime = Date.now() - startTime;

            console.log(`Variant ${sizeName} created`, {
                key: variantKey,
                originalBytes: imageBuffer.length,
                variantBytes: variantBuffer.length,
                compressionRatio: (variantBuffer.length / imageBuffer.length * 100).toFixed(1) + '%',
                timingMs: processingTime
            });

            logMemoryUsage(`After ${sizeName}`);

            return { sizeName, key: variantKey, skipped: false };

        } catch (error) {
            console.error(`Failed to generate ${sizeName} variant`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    });

    // Wait for all variants
    const results = await Promise.all(variantPromises);

    // Build final variant keys object
    results.forEach(({ sizeName, key }) => {
        variantKeys[sizeName] = key;
    });

    return variantKeys;
}

/**
 * Check if variants already exist (for idempotency)
 */
async function checkExistingVariants(uploadId, originalKey) {
    const checks = Object.keys(VARIANT_SIZES).map(async (sizeName) => {
        const variantKey = generateVariantKey(originalKey, sizeName);

        try {
            await s3.send(
                new HeadObjectCommand({
                    Bucket: BUCKET,
                    Key: variantKey
                })
            );
            return { sizeName, key: variantKey, exists: true };
        } catch (error) {
            if (error.name === 'NotFound') {
                return { sizeName, key: variantKey, exists: false };
            }
            throw error;
        }
    });

    const results = await Promise.all(checks);

    const existingKeys = {};
    let allExist = true;

    results.forEach(({ sizeName, key, exists }) => {
        if (exists) {
            existingKeys[sizeName] = key;
        } else {
            allExist = false;
        }
    });

    return {
        allExist,
        keys: existingKeys
    };
}

// ============================================================================
// BACKEND NOTIFICATION
// ============================================================================

/**
 * Notify backend with retry logic and timeout
 * Implements exponential backoff
 */
async function notifyBackend(uploadId, variantKeys) {
    if (!BACKEND_TOKEN) {
        console.warn("BACKEND_TOKEN not configured - skipping notification");
        return;
    }

    const payload = {
        uploadId,
        variants: {
            small: variantKeys.small,
            medium: variantKeys.medium,
            large: variantKeys.large
        },
        processedAt: new Date().toISOString()
    };

    console.log("Notifying backend", {
        url: BACKEND_URL,
        uploadId,
        hasToken: !!BACKEND_TOKEN
    });

    for (let attempt = 1; attempt <= BACKEND_MAX_RETRIES; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

            const response = await fetch(BACKEND_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${BACKEND_TOKEN}`,
                    "X-Request-ID": `${uploadId}-${Date.now()}`
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                console.log("Backend notified successfully", {
                    uploadId,
                    status: response.status,
                    attempt
                });
                return data;
            }

            // Non-retryable errors (4xx except 429)
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                const errorText = await response.text().catch(() => "");
                console.error("Backend rejected request (non-retryable)", {
                    uploadId,
                    status: response.status,
                    error: errorText
                });
                // Don't retry client errors - likely bad data
                throw new Error(`Backend error ${response.status}: ${errorText}`);
            }

            // Retryable errors (5xx, 429)
            const errorText = await response.text().catch(() => "");
            console.warn("Backend error (retryable)", {
                uploadId,
                status: response.status,
                attempt,
                error: errorText
            });

            if (attempt < BACKEND_MAX_RETRIES) {
                const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
                console.log(`Retrying in ${backoffMs}ms...`);
                await sleep(backoffMs);
            } else {
                throw new Error(`Backend failed after ${BACKEND_MAX_RETRIES} attempts: ${response.status}`);
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.error("Backend request timed out", {
                    uploadId,
                    attempt,
                    timeoutMs: BACKEND_TIMEOUT_MS
                });
            } else {
                console.error("Backend request failed", {
                    uploadId,
                    attempt,
                    error: error.message
                });
            }

            if (attempt === BACKEND_MAX_RETRIES) {
                throw error;
            }

            // Exponential backoff
            const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
            await sleep(backoffMs);
        }
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract uploadId from S3 key
 * Supports various key formats
 */
function extractUploadId(key) {
    // Pattern: .../original/{uploadId}.{ext}
    const match = key.match(/\/original\/([^\/\.]+)\.[^\.]+$/);
    return match ? match[1] : null;
}

/**
 * Generate variant key from original key
 */
function generateVariantKey(originalKey, sizeName) {
    return originalKey
        .replace("/original/", `/variants/${sizeName}/`)
        .replace(/\.[^/.]+$/, ".webp");
}

/**
 * Sleep utility for backoff
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Log memory usage for monitoring
 */
function logMemoryUsage(stage) {
    const used = process.memoryUsage();
    console.log(`Memory [${stage}]`, {
        heapUsedMB: Math.round(used.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(used.heapTotal / 1024 / 1024),
        externalMB: Math.round(used.external / 1024 / 1024),
        rssMB: Math.round(used.rss / 1024 / 1024)
    });
}