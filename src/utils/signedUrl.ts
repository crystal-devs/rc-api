// utils/signedUrl.ts
// DEPRECATED: Use cloudfront-url.util.ts instead
// This file is kept for backward compatibility

import { getCachedSignedUrl as getRedisSignedUrl } from './cloudfront-url.util';

/**
 * @deprecated Use getCachedSignedUrl from cloudfront-url.util.ts instead
 * This wrapper is kept for backward compatibility
 */
export const getCachedSignedUrl = async (
    key: string,
    expiresIn = 3600
): Promise<string> => {
    return getRedisSignedUrl(key, expiresIn);
};