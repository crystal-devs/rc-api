import { Request, Response, NextFunction } from "express";
import { sendResponse } from "@utils/express.util";
import { trimObject } from "@utils/sanitizers.util";
import { injectedRequest } from "types/injected-types";
import { createBulkDownloadService, getBulkDownloadStatusService } from "@services/media/bulk-download.service";

export const createBulkDownloadController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const { eventId, shareToken, requestedById, requestedByType, quality = "original" } = trimObject(req.body);

        console.info(`[createBulkDownloadController] Creating bulk download for event ${eventId}`);

        if (!eventId || !requestedById || !requestedByType) {
            throw new Error('Missing required fields: eventId, requestedById, requestedByType');
        }

        const response = await createBulkDownloadService({
            eventId,
            shareToken,
            requestedById,
            requestedByType,
            quality
        });

        sendResponse(res, response);
    } catch (error) {
        console.error(`[createBulkDownloadController] Error: ${error.message}`);
        sendResponse(res, {
            status: false,
            code: 500,
            message: 'Failed to create bulk download',
            data: null,
            error: { message: error.message },
            other: null,
        });
    }
};

export const getBulkDownloadStatusController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const { jobId } = trimObject(req.params);

        console.info(`[getBulkDownloadStatusController] Fetching status for job ${jobId}`);

        if (!jobId) {
            throw new Error('Valid job ID is required');
        }

        const response = await getBulkDownloadStatusService({ jobId });

        sendResponse(res, response);
    } catch (error) {
        console.error(`[getBulkDownloadStatusController] Error: ${error.message}`);
        sendResponse(res, {
            status: false,
            code: 500,
            message: 'Failed to get bulk download status',
            data: null,
            error: { message: error.message },
            other: null,
        });
    }
};