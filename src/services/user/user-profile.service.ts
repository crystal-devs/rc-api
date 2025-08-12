// 2. services/user/user-profile.service.ts
// ====================================

import { User, UserType } from "@models/user.model";
import { logger } from "@utils/logger";
import type { ServiceResponse, UserProfile } from './user.types';

export const getUserByIdService = async (user_id: string): Promise<UserType> => {
    const user = await User.findById(user_id);
    if (!user) {
        throw new Error("User not found");
    }
    return user;
};

export const getUserProfileService = async (userId: string): Promise<ServiceResponse<UserProfile>> => {
    try {
        const user = await User.findById(userId).select('-password').lean();

        if (!user) {
            throw new Error("User not found");
        }

        const userProfile: UserProfile = {
            _id: user._id,
            name: user.name,
            email: user.email,
            phone_number: user.phone_number,
            profile_pic: user.profile_pic,
            provider: user.provider,
            country_code: user.country_code,
            preferences: user.preferences,
            lastLoginAt: user.lastLoginAt,
            createdAt: user.createdAt
        };

        return {
            status: true,
            data: userProfile
        };
    } catch (error: any) {
        logger.error(`Error in getUserProfileService: ${error.message}`);
        throw error;
    }
};
