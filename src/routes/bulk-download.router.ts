import { createBulkDownloadController, getBulkDownloadStatusController } from '@controllers/bulk-download.controller';
import express, { RequestHandler } from 'express';


const bulkDownloadRouter = express.Router();

import {
    createBulkDownloadRateLimiter,
    bulkDownloadStatusRateLimiter
} from '@configs/security.config';

// Routes
bulkDownloadRouter.post('/bulk', createBulkDownloadRateLimiter, createBulkDownloadController as RequestHandler);
bulkDownloadRouter.get('/status/:jobId', bulkDownloadStatusRateLimiter, getBulkDownloadStatusController as RequestHandler);

// Guest bulk download route (with share token)
bulkDownloadRouter.post('/guest/:shareToken/bulk', createBulkDownloadRateLimiter, createBulkDownloadController as RequestHandler);

export default bulkDownloadRouter;