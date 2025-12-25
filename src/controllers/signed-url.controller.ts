// controllers/signed-url.controller.ts
import { Request, Response } from 'express';
import { getCachedSignedUrl } from '@utils/cloudfront-url.util';
import { logger } from '@utils/logger';

/**
 * Generate signed URL for an S3 key
 * Used for event covers and other permanent S3 resources
 */
export const getSignedUrlForKeyController = async (req: Request, res: Response) => {
    try {
        const { key } = req.body;

        if (!key || typeof key !== 'string') {
            return res.status(400).json({
                status: false,
                code: 400,
                message: 'S3 key is required and must be a string',
                error: { message: 'Invalid or missing key parameter' }
            });
        }

        // Validate key format (should be a proper S3 key)
        if (!key.includes('/') || key.length < 10) {
            return res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid S3 key format',
                error: { message: 'Key must be a valid S3 object key' }
            });
        }

        logger.debug(`Generating signed URL for key: ${key.substring(0, 50)}...`);

        // Generate signed URL with default 1 hour expiration
        const signedUrl = await getCachedSignedUrl(key, 3600); // 1 hour

        logger.debug(`Successfully generated signed URL for key: ${key.substring(0, 30)}...`);

        return res.status(200).json({
            status: true,
            code: 200,
            message: 'Signed URL generated successfully',
            data: {
                signed_url: signedUrl,
                key: key,
                expires_in: 3600
            }
        });

    } catch (error: any) {
        logger.error('Error generating signed URL for key:', error);

        return res.status(500).json({
            status: false,
            code: 500,
            message: 'Failed to generate signed URL',
            error: {
                message: error.message || 'Internal server error',
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        });
    }
};