import { Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { injectedRequest } from '../types/injected-types';
import { checkUserLimitsService, getUserSubscriptionService } from '@services/user';

/**
 * Middleware to check if user has reached their event creation limit
 */
export const checkEventLimitMiddleware = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>> => {
    try {
        const userId = req.user._id.toString();
        
        if (!userId) {
            return res.status(401).json({
                status: false,
                message: 'User not authenticated'
            });
        }
        
        // Check if user has reached their event limit
        const hasEventCapacity = await checkUserLimitsService(userId, 'event');
        
        if (!hasEventCapacity) {
            return res.status(403).json({
                status: false,
                message: 'You have reached your maximum event limit. Please upgrade your subscription to create more events.'
            });
        }
        
        // If user hasn't reached their limit, proceed to next middleware/controller
        next();
    } catch (error: any) {
        logger.error(`Error in checkEventLimitMiddleware: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: 'Failed to check subscription limits'
        });
    }
};

/**
 * Middleware to check if user has reached their storage limit
 */
export const checkStorageLimitMiddleware = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>> => {
    try {
        const userId = req.user._id.toString();
        
        if (!userId) {
            return res.status(401).json({
                status: false,
                message: 'User not authenticated'
            });
        }
        
        // Get file size from request if it exists
        // Convert to MB for comparison with limits
        const fileSizeInBytes = (req as any).file?.size || 0;
        const fileSizeInMB = fileSizeInBytes / (1024 * 1024);
        
        // Check if user has reached their storage limit
        const hasStorageCapacity = await checkUserLimitsService(userId, 'storage', fileSizeInMB);
        
        if (!hasStorageCapacity) {
            return res.status(403).json({
                status: false,
                message: 'You have reached your maximum storage limit. Please upgrade your subscription or delete some media to free up space.'
            });
        }
        
        // If user hasn't reached their limit, proceed to next middleware/controller
        next();
    } catch (error: any) {
        logger.error(`Error in checkStorageLimitMiddleware: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: 'Failed to check subscription limits'
        });
    }
};

/**
 * Middleware to check if user has reached their photo limit for a specific event
 */
export const checkEventPhotoLimitMiddleware = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>> => {
    try {
        console.log('=== Starting checkEventPhotoLimitMiddleware ===');
        console.log('Request body:', req.body);
        console.log('Request params:', req.params);
        
        const userId = req.user._id.toString();
        console.log('User ID:', userId);
        
        if (!userId) {
            return res.status(401).json({
                status: false,
                message: 'User not authenticated'
            });
        }
        
        // Get event ID from request body or params
        const eventId = (req.body as any).event_id || req.params.event_id;
        console.log('Event ID from request:', eventId, 'Type:', typeof eventId);
        
        if (!eventId) {
            console.log('No event ID found in request');
            return res.status(400).json({
                status: false,
                message: 'Event ID is required'
            });
        }
        
        console.log('Checking photo capacity for event:', eventId);
        
        // Check if adding this photo would exceed the limit for the event
        // We pass the eventId to the service to check against the limit
        const hasPhotoCapacity = await checkUserLimitsService(userId, 'photo', eventId);
        console.log('Photo capacity check result:', hasPhotoCapacity);
        
        if (!hasPhotoCapacity) {
            return res.status(403).json({
                status: false,
                message: 'You have reached the maximum photo limit for this event. Please upgrade your subscription to add more photos.'
            });
        }
        
        // If user hasn't reached their limit, proceed to next middleware/controller
        next();
    } catch (error: any) {
        logger.error(`Error in checkEventPhotoLimitMiddleware: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: 'Failed to check subscription limits'
        });
    }
};

/**
 * Middleware to check file size against user's plan limit
 */
export const checkFileSizeLimitMiddleware = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>> => {
    try {
        const userId = req.user._id.toString();
        
        if (!userId) {
            return res.status(401).json({
                status: false,
                message: 'User not authenticated'
            });
        }
        
        // If no file in the request, skip this check
        if (!(req as any).file) {
            return next();
        }
        
        // Get user subscription to check max file size
        const userSubscriptionResult = await getUserSubscriptionService(userId);
        const subscription = userSubscriptionResult.data;
        
        // Convert file size from bytes to MB for comparison
        const fileSizeInBytes = (req as any).file.size;
        const fileSizeInMB = fileSizeInBytes / (1024 * 1024);
        
        // Check if file size exceeds the limit
        if (fileSizeInMB > subscription.limits.maxPhotoSize) {
            return res.status(413).json({
                status: false,
                message: `File size exceeds the maximum allowed size of ${subscription.limits.maxPhotoSize}MB for your subscription plan.`
            });
        }
        
        // If file size is within limit, proceed to next middleware/controller
        next();
    } catch (error: any) {
        logger.error(`Error in checkFileSizeLimitMiddleware: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: 'Failed to check file size limit'
        });
    }
};
