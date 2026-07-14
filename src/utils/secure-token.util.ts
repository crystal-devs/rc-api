import crypto from 'crypto';

/**
 * Generates a URL-safe, cryptographically random token.
 *
 * Share/guest/invite tokens are bearer credentials (they grant gallery access
 * with no further auth), so they must come from a CSPRNG — never Math.random().
 *
 * 16 bytes → 128 bits of entropy → 22 base64url chars ([A-Za-z0-9_-]).
 */
export const TOKEN_RANDOM_LENGTH = 22;

export const generateSecureToken = (prefix: string, bytes = 16): string => {
    return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
};

/** Matches the random part produced by generateSecureToken with default size. */
export const SECURE_TOKEN_PATTERN = `[A-Za-z0-9_-]{${TOKEN_RANDOM_LENGTH}}`;
