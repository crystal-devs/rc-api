// configs/cloudfront.config.ts
// CloudFront configuration for future CDN migration

import { logger } from '@utils/logger';

export interface CloudFrontConfig {
    enabled: boolean;
    distributionDomain: string;
    keyPairId: string;
    privateKey: string;
    defaultExpiration: number; // seconds
}

/**
 * CloudFront configuration
 * Set USE_CLOUDFRONT=true in .env to enable CloudFront URLs
 */
export const cloudFrontConfig: CloudFrontConfig = {
    // Feature flag - set to true when ready to migrate to CloudFront
    enabled: process.env.USE_CLOUDFRONT === 'true',

    // CloudFront distribution domain (e.g., 'd111111abcdef8.cloudfront.net')
    distributionDomain: process.env.CLOUDFRONT_DOMAIN || '',

    // CloudFront key pair ID for signed URLs
    keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID || '',

    // CloudFront private key (base64 encoded or file path)
    privateKey: process.env.CLOUDFRONT_PRIVATE_KEY || '',

    // Default expiration for CloudFront signed URLs (24 hours)
    defaultExpiration: parseInt(process.env.CLOUDFRONT_URL_EXPIRATION || '86400')
};

/**
 * Validate CloudFront configuration
 */
export function validateCloudFrontConfig(): boolean {
    if (!cloudFrontConfig.enabled) {
        return true; // Not enabled, no validation needed
    }

    const errors: string[] = [];

    if (!cloudFrontConfig.distributionDomain) {
        errors.push('CLOUDFRONT_DOMAIN is required when CloudFront is enabled');
    }

    if (!cloudFrontConfig.keyPairId) {
        errors.push('CLOUDFRONT_KEY_PAIR_ID is required when CloudFront is enabled');
    }

    if (!cloudFrontConfig.privateKey) {
        errors.push('CLOUDFRONT_PRIVATE_KEY is required when CloudFront is enabled');
    }

    if (errors.length > 0) {
        logger.error('CloudFront configuration errors:', errors);
        return false;
    }

    logger.info('✅ CloudFront configuration validated successfully');
    return true;
}

/**
 * Check if CloudFront is enabled and configured
 */
export function isCloudFrontEnabled(): boolean {
    return cloudFrontConfig.enabled && validateCloudFrontConfig();
}

/**
 * Get CloudFront URL from S3 key
 */
export function getCloudFrontUrl(s3Key: string): string {
    if (!cloudFrontConfig.distributionDomain) {
        throw new Error('CloudFront domain not configured');
    }

    // Remove leading slash if present
    const cleanKey = s3Key.startsWith('/') ? s3Key.substring(1) : s3Key;

    return `https://${cloudFrontConfig.distributionDomain}/${cleanKey}`;
}
