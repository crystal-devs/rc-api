import { OAuth2Client } from 'google-auth-library';
import { logger } from '@utils/logger';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export interface GoogleUserInfo {
    email: string;
    name: string;
    picture?: string;
    email_verified: boolean;
    sub: string; // Google user ID
}

export class GoogleAuthService {
    /**
     * Exchange authorization code for access token and ID token
     */
    async exchangeCodeForTokens(code: string, redirectUri: string): Promise<any> {
        try {
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    code,
                    client_id: process.env.GOOGLE_CLIENT_ID!,
                    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            });

            if (!tokenResponse.ok) {
                throw new Error('Failed to exchange code for tokens');
            }

            const tokens = await tokenResponse.json();

            logger.info('Successfully exchanged code for tokens');

            return tokens;
        } catch (error: any) {
            logger.error('Code exchange failed', { error: error.message });
            throw new Error(`Code exchange failed: ${error.message}`);
        }
    }

    /**
     * Verify Google access token and extract user information
     * Uses Google's tokeninfo endpoint for verification
     */
    async verifyAccessToken(accessToken: string): Promise<GoogleUserInfo> {
        try {
            // Verify token with Google's tokeninfo endpoint
            const response = await fetch(
                `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${accessToken}`
            );

            if (!response.ok) {
                throw new Error('Invalid Google access token');
            }

            const tokenInfo = await response.json();

            // Note: Access tokens don't have a reliable 'aud' field
            // The token is verified by Google's API, which is sufficient
            // For stricter validation, use ID tokens with verifyIdToken()

            // Verify email is present and verified
            if (!tokenInfo.email) {
                throw new Error('Email not found in token');
            }

            if (tokenInfo.email_verified !== 'true' && tokenInfo.email_verified !== true) {
                throw new Error('Email not verified by Google');
            }

            logger.info('Google token verified successfully', {
                email: tokenInfo.email,
                sub: tokenInfo.sub
            });

            return {
                email: tokenInfo.email,
                name: tokenInfo.name || tokenInfo.email.split('@')[0],
                picture: tokenInfo.picture,
                email_verified: true,
                sub: tokenInfo.sub
            };
        } catch (error: any) {
            logger.error('Google token verification failed', {
                error: error.message
            });
            throw new Error(`Google token verification failed: ${error.message}`);
        }
    }

    /**
     * Verify ID token (alternative method using google-auth-library)
     * More secure but requires ID token instead of access token
     */
    async verifyIdToken(idToken: string): Promise<GoogleUserInfo> {
        try {
            const ticket = await client.verifyIdToken({
                idToken,
                audience: process.env.GOOGLE_CLIENT_ID
            });

            const payload = ticket.getPayload();

            if (!payload) {
                throw new Error('Invalid ID token payload');
            }

            if (!payload.email) {
                throw new Error('Email not found in token');
            }

            if (!payload.email_verified) {
                throw new Error('Email not verified by Google');
            }

            logger.info('Google ID token verified successfully', {
                email: payload.email,
                sub: payload.sub
            });

            return {
                email: payload.email,
                name: payload.name || payload.email.split('@')[0],
                picture: payload.picture,
                email_verified: payload.email_verified,
                sub: payload.sub!
            };
        } catch (error: any) {
            logger.error('Google ID token verification failed', {
                error: error.message
            });
            throw new Error(`Google ID token verification failed: ${error.message}`);
        }
    }
}

// Singleton instance
export const googleAuthService = new GoogleAuthService();
