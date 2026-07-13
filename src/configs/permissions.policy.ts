// configs/permissions.policy.ts
//
// Central RBAC policy — the single source of truth for what each event role
// may do. Design: rc-frontend/docs/RBAC_DESIGN.md.
//
// Rules of this module:
// - Role ASSIGNMENTS are stored (event_participants.role); what a role can do
//   lives ONLY here, in code. Never persist computed permissions.
// - Guests are additionally gated by the event-level host toggles
//   (event.permissions.can_view/can_upload/can_download) — those are product
//   settings that parameterize what "guest" means for one event, applied in
//   effectivePermissions().
// - No per-user overrides (product decision 2026-07-11): the three roles are
//   the only granularity.

// The synthetic token-access role 'authenticated_guest' behaves like 'guest'.
export type PolicyRole = 'creator' | 'co_host' | 'guest' | 'authenticated_guest';

export const ACTIONS = [
    // Event lifecycle
    'event.view',
    'event.update',          // edit details + full settings screen
    'event.archive',         // close/reopen for guests — creator only
    'event.delete',          // creator only
    'event.transfer',        // creator only

    // Media
    'media.view',
    'media.upload',
    'media.download',
    'media.approve',         // moderation queue approve/reject
    'media.delete',
    'media.hide',

    // Participants
    'participants.view',     // see who joined (guest-safe: names/avatars only)
    'participants.manage',   // host management surface: full list, activity, stats, sessions
    'participants.invite',
    'participants.remove',   // remove/block guests, revoke guest sessions
    'participants.update',   // status/permission records of guests
    'cohost.invite',         // share or manage the co-host invite link
    'cohost.manage',         // approve/reject/remove/block co-hosts — creator only

    // Content organisation
    'album.manage',          // create/edit/delete albums

    // Sharing & display
    'share.manage',          // share link, PIN, photo wall settings

    // Insights
    'analytics.view',
    'data.export',
] as const;

export type Action = (typeof ACTIONS)[number];

const ALL_ACTIONS: ReadonlySet<Action> = new Set(ACTIONS);

// Actions that stay creator-gated no matter what (cannot be granted):
// deleting/transferring the event, and closing it for all guests.
const CREATOR_ONLY: ReadonlySet<Action> = new Set<Action>([
    'event.archive',
    'event.delete',
    'event.transfer',
    'cohost.manage',
]);

const CO_HOST_POLICY: ReadonlySet<Action> = new Set<Action>([
    'event.view',
    'event.update',
    'media.view',
    'media.upload',
    'media.download',
    'media.approve',
    'media.delete',
    'media.hide',
    'participants.view',
    'participants.manage',
    'participants.invite',
    'participants.remove',
    'participants.update',
    'cohost.invite',
    'album.manage',
    'share.manage',
    'analytics.view',
    'data.export',
]);

// Guests: browse, contribute, see who else is at the event. Upload/download/
// view are further gated by the event-level toggles in effectivePermissions().
const GUEST_POLICY: ReadonlySet<Action> = new Set<Action>([
    'event.view',
    'media.view',
    'media.upload',
    'media.download',
    'participants.view',
]);

export const ROLE_POLICY: Record<PolicyRole, ReadonlySet<Action>> = {
    creator: ALL_ACTIONS,
    co_host: CO_HOST_POLICY,
    guest: GUEST_POLICY,
    authenticated_guest: GUEST_POLICY,
};

/** Event-level guest switches (subset of the event.permissions document). */
export interface EventGuestSettings {
    can_view?: boolean;
    can_upload?: boolean;
    can_download?: boolean;
}

const isGuestRole = (role: PolicyRole) =>
    role === 'guest' || role === 'authenticated_guest';

/**
 * Compute the effective action set for a role in a given event.
 *
 * effective = ROLE_POLICY[role]            for hosts
 * effective = GUEST_POLICY ∧ event toggles for guests
 */
export function effectivePermissions(
    role: PolicyRole,
    eventGuestSettings?: EventGuestSettings | null
): Set<Action> {
    const base = new Set<Action>(ROLE_POLICY[role] ?? GUEST_POLICY);

    if (isGuestRole(role)) {
        const settings = eventGuestSettings ?? {};
        if (settings.can_view === false) {
            base.delete('media.view');
        }
        if (settings.can_upload === false) {
            base.delete('media.upload');
        }
        // Downloads are opt-in for guests: only allowed when explicitly enabled.
        if (settings.can_download !== true) {
            base.delete('media.download');
        }
    }

    return base;
}

/** True when the action can never be performed by anyone but the creator. */
export function isCreatorOnly(action: Action): boolean {
    return CREATOR_ONLY.has(action);
}
