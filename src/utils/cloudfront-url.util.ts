// utils/cloudfront-url.util.ts
// CloudFront signed URL generation (for future use)

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { cloudFrontConfig, isCloudFrontEnabled, getCloudFrontUrl } from '@configs/cloudfront.config';
import { signedUrlCache } from '@services/cache/signed-url-cache.service';
import { logger } from '@utils/logger';
import crypto from 'crypto';

const s3Client = new S3Client();

/**
 * Generate CloudFront signed URL
 * NOTE: This is prepared for future use but not active yet
 */
async function generateCloudFrontSignedUrl(
    s3Key: string,
    expiresIn: number = 86400 // 24 hours default for CloudFront
): Promise<string> {
    try {
        const cloudFrontUrl = getCloudFrontUrl(s3Key);
        const expirationTime = Math.floor(Date.now() / 1000) + expiresIn;

        // Create policy statement
        const policy = {
            Statement: [
                {
                    Resource: cloudFrontUrl,
                    Condition: {
                        DateLessThan: {
                            'AWS:EpochTime': expirationTime
                        }
                    }
                }
            ]
        };

        const policyString = JSON.stringify(policy);
        const policyBase64 = Buffer.from(policyString)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\=/g, '_')
            .replace(/\//g, '~');

        // Sign the policy
        const sign = crypto.createSign('RSA-SHA1');
        sign.update(policyString);

        // Decode private key if it's base64 encoded
        let privateKey = cloudFrontConfig.privateKey;
        if (!privateKey.includes('BEGIN RSA PRIVATE KEY')) {
            privateKey = Buffer.from(privateKey, 'base64').toString('utf-8');
        }

        const signature = sign.sign(privateKey, 'base64')
            .replace(/\+/g, '-')
            .replace(/\=/g, '_')
            .replace(/\//g, '~');

        // Construct signed URL
        const signedUrl = `${cloudFrontUrl}?Policy=${policyBase64}&Signature=${signature}&Key-Pair-Id=${cloudFrontConfig.keyPairId}`;

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
    expiresIn: number = 3600
): Promise<string> {
    try {
        // Check cache first
        const cachedUrl = await signedUrlCache.get(s3Key, expiresIn);
        if (cachedUrl) {
            return cachedUrl;
        }

        // Generate S3 signed URL first (to get the signature and cache headers)
        let url = await generateS3SignedUrl(s3Key, expiresIn);

        if (isCloudFrontEnabled()) {
            // Use CloudFront as a CDN proxy for the signed S3 URL
            logger.debug('Using CloudFront domain for S3 signed URL');

            // Replace S3 host with CloudFront domain
            // S3 URL format: https://bucket.s3.region.amazonaws.com/key?params...
            // Target format: https://cloudfront-domain/key?params...

            try {
                const urlObj = new URL(url);
                urlObj.hostname = cloudFrontConfig.distributionDomain;
                url = urlObj.toString();
            } catch (err) {
                logger.error('Error replacing S3 host with CloudFront domain:', err);
                // Fallback to original S3 URL if replacement fails
            }
        }

        // Cache the (possibly modified) URL
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
            expiresIn: k.expiresIn || 3600
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
                // Generate S3 signed URL first
                let url = await generateS3SignedUrl(key, expiresIn);

                if (isCloudFrontEnabled()) {
                    try {
                        const urlObj = new URL(url);
                        urlObj.hostname = cloudFrontConfig.distributionDomain;
                        url = urlObj.toString();
                    } catch (err) {
                        logger.error('Error replacing S3 host with CloudFront domain in batch:', err);
                    }
                }

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
