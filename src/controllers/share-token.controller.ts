import { Request, Response, NextFunction } from "express";
import * as shareTokenService from "@services/share-token.service";
import { sendResponse } from "@utils/express.util";
import { trimObject } from "@utils/sanitizers.util";
import mongoose from "mongoose";
import { injectedRequest } from "types/injected-types";

export const getEventShareTokensController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const {
            page = 1,
            limit = 10,
            type = 'all',
            status = 'active'
        } = trimObject(req.query);

        const response = await shareTokenService.getEventShareTokensService({
            eventId: event_id,
            requesterId: req.user._id.toString(),
            page: parseInt(page as string),
            limit: parseInt(limit as string),
            type: type as string,
            status: status as string
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const createShareTokenController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const {
            token_type = 'invite',
            permissions,
            restrictions = {},
            album_id,
            name,
            description
        } = trimObject(req.body);

        const tokenData = {
            eventId: event_id,
            albumId: album_id,
            tokenType: token_type,
            permissions: permissions || {
                view: true,
                upload: false,
                download: false,
                share: false,
                comment: true
            },
            restrictions,
            createdBy: req.user._id.toString(),
            name,
            description
        };

        const response = await shareTokenService.createShareTokenService(tokenData);
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

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
export const updateShareTokenController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token_id } = trimObject(req.params);
        const updateData = trimObject(req.body);

        if (!mongoose.Types.ObjectId.isValid(token_id)) {
            throw new Error("Valid token ID is required");
        }

        const response = await shareTokenService.updateShareTokenService({
            tokenId: token_id,
            updateData,
            updatedBy: req.user._id.toString()
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const revokeShareTokenController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token_id } = trimObject(req.params);
        const { reason = '' } = trimObject(req.body);

        if (!mongoose.Types.ObjectId.isValid(token_id)) {
            throw new Error("Valid token ID is required");
        }

        const response = await shareTokenService.revokeShareTokenService({
            tokenId: token_id,
            revokedBy: req.user._id.toString(),
            reason
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const getTokenAnalyticsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token_id } = trimObject(req.params);
        const {
            period = '30d',
            metrics = 'all'
        } = trimObject(req.query);

        if (!mongoose.Types.ObjectId.isValid(token_id)) {
            throw new Error("Valid token ID is required");
        }

        const response = await shareTokenService.getTokenAnalyticsService({
            tokenId: token_id,
            requesterId: req.user._id.toString(),
            period: period as string,
            metrics: metrics as string
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

// ============= PUBLIC TOKEN ENDPOINTS =============

export const joinEventViaTokenController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token } = trimObject(req.params);
        const {
            guest_info,
            user_id
        } = trimObject(req.body);

        if (!token) {
            throw new Error("Token is required");
        }

        // Validate guest info
        if (!guest_info?.email || !guest_info?.name) {
            throw new Error("Guest email and name are required");
        }

        const response = await shareTokenService.joinEventViaTokenService({
            token,
            guestInfo: {
                email: guest_info.email.toLowerCase().trim(),
                name: guest_info.name.trim(),
                avatar_url: guest_info.avatar_url || '',
                is_anonymous: !user_id
            },
            userId: user_id || null
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const getTokenInfoController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token } = trimObject(req.params);

        if (!token) {
            throw new Error("Token is required");
        }

        const response = await shareTokenService.getTokenInfoService(token);
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

// Get token details by token string (not ObjectId)
export const getTokenDetailsByStringController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token } = trimObject(req.params);
        
        console.log('===== GET TOKEN DETAILS BY STRING REQUEST =====', token);
        if (!token) {
            throw new Error("Token string is required");
        }

        // This will reuse the same service as the public token info endpoint
        const response = await shareTokenService.getTokenInfoService(token);
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};