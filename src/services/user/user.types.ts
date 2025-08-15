// 1. services/user/user.types.ts
// ====================================

import type { UserType } from "@models/user.model";
import type { UserSubscriptionType } from "@models/user-subscription.model";
import type { UserUsageType } from "@models/user-usage.model";

export interface ServiceResponse<T> {
    status: boolean;
    message?: string;
    data?: T;
    error?: any;
}

export interface UserProfile {
    _id: string;
    name: string;
    email: string;
    phone_number?: string;
    profile_pic?: string;
    provider: string;
    country_code?: string;
    preferences?: any;
    lastLoginAt?: Date;
    createdAt: Date;
}

export interface FormattedSubscription {
    id: string;
    userId: string;
    planId: string;
    planName: string;
    status: string;
    limits: {
        maxEvents: number;
        maxPhotosPerEvent: number;
        maxStorage: number;
        maxPhotoSize: number; // Size in bytes
    };
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface FormattedUsage {
    userId: string;
    date: Date;
    metrics: {
        photosUploaded: number;
        storageUsed: number;
        eventsCreated: number;
        activeEvents: string[];
    };
    totals: {
        photos: number;
        storage: number;
        events: number;
    };
}

export interface UserStatistics {
    totalEvents: number;
    totalHostedEvents: number;
    totalAttendingEvents: number;
    totalPhotos: number;
    totalVideos: number;
    totalMedia: number;
}

export type LimitCheckType = 'event' | 'photo' | 'storage';

export interface UpgradeSubscriptionOptions {
    planId: string;
    paymentMethodId?: string;
}
