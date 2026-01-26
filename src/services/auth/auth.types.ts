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
    password?: string;
    googleAccessToken?: string; // For Google OAuth verification
}

export interface LoginResult {
    token: string;
    refreshToken: string;
    message: string;
    status: boolean;
    expiresAt?: string; // Access token expiry
    user?: {
        id: string;
        email?: string;
        phone_number?: string;
        name: string;
        profile_pic?: string;
        provider: string;
    };
}

export interface LogoutRequest {
    refreshToken: string;
}

export interface GoogleAuthRequest {
    redirect_uri?: string;
}

export interface GoogleAuthCallbackRequest {
    code: string;
    redirectUri: string;
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
    jti?: string; // JWT ID for per-token revocation
    iat?: number;
    exp?: number;
}

export interface AuthValidationResult {
    valid: boolean;
    user?: any;
    error?: string;
}