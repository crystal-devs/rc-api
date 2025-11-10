import { createBulkDownloadController, getBulkDownloadStatusController } from '@controllers/bulk-download.controller';
import express, { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

const bulkDownloadRouter = express.Router();

// Rate limiting middleware for bulk download requests
const createDownloadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3, // Max 3 requests per window per IP
    message: {
        success: false,
        message: 'Too many download requests. Please wait 5 minutes before trying again.',
        code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip successful requests from rate limiting
    skipSuccessfulRequests: false,
    // Custom key generator to include user identification
    keyGenerator: (req) => {
        const guestId = req.body?.guestId;
        const authHeader = req.headers.authorization;

        if (authHeader) {
            // Use auth header for authenticated users
            return `auth_${authHeader.slice(-10)}`;
        } else if (guestId) {
            // Use guest ID for guest users
            return `guest_${guestId}`;
        } else {
            // Fall back to IP
            return req.ip;
        }
    }
});

// General rate limiter for status checks
const statusLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // Max 30 status checks per minute per IP
    message: {
        success: false,
        message: 'Too many status requests',
        code: 'RATE_LIMIT_EXCEEDED'
    }
});

// Routes
bulkDownloadRouter.post('/bulk', createDownloadLimiter, createBulkDownloadController as RequestHandler);
bulkDownloadRouter.get('/status/:jobId', statusLimiter, getBulkDownloadStatusController as RequestHandler);

// Guest bulk download route (with share token)
bulkDownloadRouter.post('/guest/:shareToken/bulk', createDownloadLimiter, createBulkDownloadController as RequestHandler);

export default bulkDownloadRouter;