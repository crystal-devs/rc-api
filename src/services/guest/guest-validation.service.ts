// 2. services/guest/guest-validation.service.ts
// ====================================

import { Event } from '@models/event.model';
import { getFileType, isValidImageFormat, cleanupFile, bytesToMB } from '@utils/file.util';
import { logger } from '@utils/logger';
import type { GuestUploadPermission } from './guest.types';

export const validateGuestUploadPermission = async (shareToken: string): Promise<GuestUploadPermission> => {
    try {
        const event = await Event.findOne({ share_token: shareToken });

        if (!event) {
            return {
                allowed: false,
                reason: 'Event not found'
            };
        }

        if (!event.permissions?.can_upload) {
            return {
                allowed: false,
                event,
                reason: 'Uploads not allowed for this event'
            };
        }

        return {
            allowed: true,
            event
        };

    } catch (error: any) {
        logger.error('Error checking guest upload permission:', error);
        return {
            allowed: false,
            reason: 'Server error'
        };
    }
};

export const validateGuestFile = async (file: Express.Multer.File): Promise<{
    valid: boolean;
    fileType?: string;
    error?: string;
}> => {
    try {
        // Validate file type
        const fileType = getFileType(file);
        if (!fileType) {
            await cleanupFile(file);
            return {
                valid: false,
                error: 'Unsupported file type. Only images and videos are allowed.'
            };
        }

        // For images, validate format
        if (fileType === 'image' && !isValidImageFormat(file)) {
            await cleanupFile(file);
            return {
                valid: false,
                error: 'Unsupported image format. Supported formats: JPEG, PNG, WebP, HEIC'
            };
        }

        // Check file size limits
        const maxSizeMB = 100;
        const fileSizeMB = bytesToMB(file.size);
        if (fileSizeMB > maxSizeMB) {
            await cleanupFile(file);
            return {
                valid: false,
                error: `File size exceeds limit of ${maxSizeMB}MB`
            };
        }

        return {
            valid: true,
            fileType
        };
    } catch (error: any) {
        logger.error('Error validating guest file:', error);
        await cleanupFile(file);
        return {
            valid: false,
            error: 'File validation failed'
        };
    }
};

export const validateShareToken = async (shareToken: string) => {
    const event = await Event.findOne({ share_token: shareToken });
    if (!event) {
        throw new Error('Invalid share token or event not found');
    }

    if (!event.permissions?.can_upload) {
        throw new Error('Uploads are not allowed for this event');
    }

    return event;
};

