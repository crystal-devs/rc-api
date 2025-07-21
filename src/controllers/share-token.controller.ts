import { Request, Response, NextFunction } from "express";
import * as shareTokenService from "@services/share-token.service";
import { sendResponse } from "@utils/express.util";
import { trimObject } from "@utils/sanitizers.util";
import mongoose from "mongoose";
import { injectedRequest } from "types/injected-types";

export const getShareTokenDetailsController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const { token_id } = trimObject(req.params);

        console.info(`[getShareTokenDetailsController] Fetching details for token ${token_id}`);

        if (!token_id) {
            throw new Error('Valid token ID is required');
        }

        const response = await shareTokenService.getShareTokenDetailsService({
            tokenId: token_id,
            requesterId: req.user?._id?.toString(),
        });

        sendResponse(res, response);
    } catch (error) {
        console.error(`[getShareTokenDetailsController] Error: ${error.message}`);
        sendResponse(res, {
            status: false,
            code: 500,
            message: 'Failed to get share token details',
            data: null,
            error: { message: error.message },
            other: null,
        });
    }
};
