// utils/signedUrl.ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client();

const URL_CACHE = new Map<string, { url: string; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const getCachedSignedUrl = async (
    key: string,
    expiresIn = 3600 // 1 hour
): Promise<string> => {
    const cacheKey = `${key}:${expiresIn}`;
    const cached = URL_CACHE.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
        return cached.url;
    }

    const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET!,
            Key: key,
        }),
        { expiresIn }
    );

    URL_CACHE.set(cacheKey, {
        url,
        expiresAt: Date.now() + (expiresIn * 1000 - 60 * 1000), // 1 min buffer
    });

    // Clean old entries
    if (URL_CACHE.size > 10_000) {
        for (const [k, v] of URL_CACHE.entries()) {
            if (v.expiresAt < Date.now()) URL_CACHE.delete(k);
        }
    }

    return url;
};