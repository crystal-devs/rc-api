// utils/cloudfront-url.util.ts
// CloudFront signed URL generation (for future use)

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { cloudFrontConfig, isCloudFrontEnabled, getCloudFrontUrl } from '@configs/cloudfront.config';
import { signedUrlCache } from '@services/cache/signed-url-cache.service';
import { logger } from '@utils/logger';

const s3Client = new S3Client();

/**
 * Generate a CloudFront signed URL using the distribution's trusted key group.
 */
async function generateCloudFrontSignedUrl(
    s3Key: string,
    expiresIn: number = 86400 // 24 hours default for CloudFront
): Promise<string> {
    try {
        const cloudFrontUrl = getCloudFrontUrl(s3Key);
        const dateLessThan = new Date(Date.now() + expiresIn * 1000).toISOString();

        const signedUrl = getCloudFrontSignedUrl({
            url: cloudFrontUrl,
            keyPairId: cloudFrontConfig.keyPairId,
            privateKey: cloudFrontConfig.privateKey,
            dateLessThan,
        });

        logger.debug(`Generated CloudFront signed URL for ${s3Key.substring(0, 30)}...`);
        return signedUrl;
    } catch (error) {
        logger.error('Error generating CloudFront signed URL:', error);
        throw error;
    }
}

/**
 * Generate S3 signed URL (current method)
 */
async function generateS3SignedUrl(
    s3Key: string,
    expiresIn: number = 3600
): Promise<string> {
    const command = new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET!,
        Key: s3Key,
        // 🚀 CRITICAL: Cache locally only for the duration of the signature.
        // This prevents access after the signed URL expires.
        // using 'private' to ensure it's not cached in shared proxies if that's a concern,
        // though for signed URLs, the signature itself protects it.
        // Matching max-age to expiresIn ensures the browser cache invalidates when the link does.
        ResponseCacheControl: `private, max-age=${expiresIn}, immutable`,
    });

    const url = await getS3SignedUrl(s3Client, command, { expiresIn });
    return url;
}

/**
 * Get signed URL with caching
 * Automatically uses CloudFront or S3 based on configuration
 */
export async function getCachedSignedUrl(
    s3Key: string,
    expiresIn: number = cloudFrontConfig.defaultExpiration
): Promise<string> {
    try {
        // Check cache first
        const cachedUrl = await signedUrlCache.get(s3Key, expiresIn);
        if (cachedUrl) {
            return cachedUrl;
        }

        const url = isCloudFrontEnabled()
            ? await generateCloudFrontSignedUrl(s3Key, expiresIn)
            : await generateS3SignedUrl(s3Key, expiresIn);

        await signedUrlCache.set(s3Key, url, expiresIn);

        return url;
    } catch (error) {
        logger.error('Error getting cached signed URL:', error);
        throw error;
    }
}

/**
 * Batch generate signed URLs with caching
 */
export async function getCachedSignedUrlsBatch(
    keys: Array<{ s3Key: string; expiresIn?: number }>
): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    try {
        // Prepare keys with default expiration
        const keysWithExpiration = keys.map(k => ({
            key: k.s3Key,
            expiresIn: k.expiresIn || cloudFrontConfig.defaultExpiration
        }));

        // Check cache for all keys
        const cachedUrls = await signedUrlCache.getMultiple(keysWithExpiration);

        // Identify missing keys
        const missingKeys: typeof keysWithExpiration = [];
        keysWithExpiration.forEach(({ key, expiresIn }) => {
            const cached = cachedUrls.get(key);
            if (cached) {
                result.set(key, cached);
            } else {
                missingKeys.push({ key, expiresIn });
            }
        });

        // Generate missing URLs
        if (missingKeys.length > 0) {
            const newUrls: Array<{ key: string; url: string; expiresIn: number }> = [];

            for (const { key, expiresIn } of missingKeys) {
                const url = isCloudFrontEnabled()
                    ? await generateCloudFrontSignedUrl(key, expiresIn)
                    : await generateS3SignedUrl(key, expiresIn);

                result.set(key, url);
                newUrls.push({ key, url, expiresIn });
            }

            // Batch cache new URLs
            await signedUrlCache.setMultiple(newUrls);

            logger.debug(`Generated and cached ${newUrls.length} new signed URLs`);
        }

        return result;
    } catch (error) {
        logger.error('Error in batch signed URL generation:', error);
        throw error;
    }
}

/**
 * Invalidate cached signed URL
 */
export async function invalidateCachedUrl(s3Key: string): Promise<void> {
    await signedUrlCache.invalidate(s3Key);
}
