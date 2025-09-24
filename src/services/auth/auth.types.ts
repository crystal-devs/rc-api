// ====================================
// 1. services/auth/auth.types.ts
// ====================================

export interface LoginData {
    email?: string;
    phone_number?: string;
    provider: string;
    name?: string;
    profile_pic?: string;
    country_code?: string;
}

export interface LoginResult {
    token: string;
    message: string;
    status: boolean;
    user?: {
        id: string;
        email?: string;
        phone_number?: string;
        name: string;
        profile_pic?: string;
        provider: string;
    };
}

export interface UserInitializationData {
    subscriptionCreated: boolean;
    usageCreated: boolean;
    isNewUser: boolean;
}

export interface TokenPayload {
    user_id: string;
    email?: string;
    provider: string;
    iat?: number;
    exp?: number;
}

export interface AuthValidationResult {
    valid: boolean;
    user?: any;
    error?: string;
}