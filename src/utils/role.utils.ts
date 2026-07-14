// utils/role.utils.ts - Unified Role System (backend)
// Mirrors rc-frontend/src/types/roles.ts `parseRole()` exactly.
// The product has exactly THREE roles: creator, co_host, guest.
// Legacy values (owner/admin/moderator/viewer/...) must be normalized
// through this module before any comparison — never compare raw strings.

export type CanonicalRole = 'creator' | 'co_host' | 'guest';

export const CANONICAL_ROLES: CanonicalRole[] = ['creator', 'co_host', 'guest'];

/**
 * Normalize any stored/incoming role string to a canonical role.
 * Mapping is identical to the frontend's parseRole():
 *   owner, admin            -> creator
 *   moderator, cohost, co-host -> co_host
 *   viewer, participant, member -> guest
 */
export function normalizeRole(role: unknown, fallback: CanonicalRole = 'guest'): CanonicalRole {
    if (typeof role !== 'string') return fallback;

    const normalized = role.toLowerCase();
    if (CANONICAL_ROLES.includes(normalized as CanonicalRole)) {
        return normalized as CanonicalRole;
    }

    switch (normalized) {
        case 'owner':
        case 'admin':
            return 'creator';
        case 'moderator':
        case 'cohost':
        case 'co-host':
            return 'co_host';
        case 'viewer':
        case 'participant':
        case 'member':
            return 'guest';
        default:
            return fallback;
    }
}

export const ROLE_HIERARCHY: Record<CanonicalRole, number> = {
    creator: 3,
    co_host: 2,
    guest: 1,
};

/** True when the role grants event-management (admin room) access. */
export function isAdminRole(role: unknown): boolean {
    return ROLE_HIERARCHY[normalizeRole(role)] >= ROLE_HIERARCHY.co_host;
}

/** Check if a role has higher-or-equal privilege than another (normalizes both). */
export function hasRolePrivilege(userRole: unknown, requiredRole: CanonicalRole): boolean {
    return ROLE_HIERARCHY[normalizeRole(userRole)] >= ROLE_HIERARCHY[requiredRole];
}

/** Map a canonical role to the websocket user type used for room assignment. */
export function roleToSocketType(role: unknown): 'admin' | 'co_host' | 'guest' {
    const normalized = normalizeRole(role);
    if (normalized === 'creator') return 'admin';
    if (normalized === 'co_host') return 'co_host';
    return 'guest';
}
