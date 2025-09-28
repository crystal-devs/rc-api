// configs/imagekit.config.ts
// ====================================
// Centralized ImageKit configuration

import ImageKit from 'imagekit';
import { logger } from '@utils/logger';

/**
 * Centralized ImageKit instance
 * This should be imported and used across all services that need ImageKit functionality
 */
export const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

/**
 * Validate ImageKit configuration on startup
 */
export const validateImageKitConfig = (): boolean => {
    try {
        if (!process.env.IMAGE_KIT_PUBLIC_KEY) {
            logger.error('IMAGE_KIT_PUBLIC_KEY environment variable is not set');
            return false;
        }
        
        if (!process.env.IMAGE_KIT_PRIVATE_KEY) {
            logger.error('IMAGE_KIT_PRIVATE_KEY environment variable is not set');
            return false;
        }
        
        logger.info('ImageKit configuration validated successfully');
        return true;
    } catch (error) {
        logger.error('ImageKit configuration validation failed:', error);
        return false;
    }
};

// Export the instance as default for convenience
export default imagekit;
