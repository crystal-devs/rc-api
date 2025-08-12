import { Request, Response, NextFunction } from "express";
import * as userService from "@services/user.service";
import { logger } from "@utils/logger";
import { injectedRequest } from "types/injected-types";
import { SubscriptionPlan } from "@models/subscription-plan.model";
import { getUserProfileService, getUserStatisticsService, getUserSubscriptionService, getUserUsageService, upgradeSubscriptionService } from "@services/user";

/**
 * Get user profile information
 */
export const getUserProfileController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Extract user ID from request (assuming auth middleware sets req.user)
        const userId = req.user?._id;

        if (!userId) {
            res.status(401).json({
                status: false,
                message: "Unauthorized - User not authenticated"
            });
            return;
        }

        const profileData = await getUserProfileService(userId.toString());

        res.status(200).json(profileData);
        return;
    } catch (error: any) {
        logger.error(`Error in getUserProfileController: ${error.message}`);
        next(error);
    }
};

/**
 * Get user subscription information
 */
export const getUserSubscriptionController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Extract user ID from request (assuming auth middleware sets req.user)
        const userId = req.user?._id;

        if (!userId) {
            res.status(401).json({
                status: false,
                message: "Unauthorized - User not authenticated"
            });
            return;
        }

        const subscriptionData = await getUserSubscriptionService(userId.toString());

        res.status(200).json(subscriptionData);
        return;
    } catch (error: any) {
        logger.error(`Error in getUserSubscriptionController: ${error.message}`);
        next(error);
    }
};

/**
 * Get user usage information
 */
export const getUserUsageController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Extract user ID from request (assuming auth middleware sets req.user)
        const userId = req.user?._id;

        if (!userId) {
            res.status(401).json({
                status: false,
                message: "Unauthorized - User not authenticated"
            });
            return;
        }

        const usageData = await getUserUsageService(userId.toString());

        res.status(200).json(usageData);
        return;
    } catch (error: any) {
        logger.error(`Error in getUserUsageController: ${error.message}`);
        next(error);
    }
};

/**
 * Upgrade user subscription
 */
export const upgradeSubscriptionController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Extract user ID from request (assuming auth middleware sets req.user)
        const userId = req.user?._id;

        if (!userId) {
            res.status(401).json({
                status: false,
                message: "Unauthorized - User not authenticated"
            });
            return;
        }

        const { planId, paymentMethodId } = req.body;

        if (!planId) {
            res.status(400).json({
                status: false,
                message: "Plan ID is required"
            });
            return;
        }

        const result = await upgradeSubscriptionService(
            userId.toString(),
            planId,
            paymentMethodId
        );

        res.status(200).json(result);
        return;
    } catch (error: any) {
        logger.error(`Error in upgradeSubscriptionController: ${error.message}`);
        next(error);
    }
};

/**
 * Get all subscription plans (public endpoint)
 */
export const getSubscriptionPlansController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        logger.info(`Fetching subscription plans from: ${req.originalUrl}`);

        const plans = await SubscriptionPlan.find({ isActive: true })
            .sort({ sortOrder: 1 })
            .lean();

        res.status(200).json({
            status: true,
            data: plans
        });
        return;
    } catch (error: any) {
        logger.error(`Error in getSubscriptionPlansController: ${error.message}`);
        next(error);
    }
};

/**
 * Get user statistics including events, photos, and videos
 */
export const getUserStatisticsController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Extract user ID from request (assuming auth middleware sets req.user)
        const userId = req.user?._id;

        if (!userId) {
            res.status(401).json({
                status: false,
                message: "Unauthorized - User not authenticated"
            });
            return;
        }

        const statisticsData = await getUserStatisticsService(userId.toString());

        if (!statisticsData.status) {
            res.status(500).json(statisticsData);
            return;
        }

        res.status(200).json(statisticsData);
        return;
    } catch (error: any) {
        logger.error(`Error in getUserStatisticsController: ${error.message}`);
        next(error);
    }
};
