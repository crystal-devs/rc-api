// Phase 1.1 — template-driven creation.
// The server owns these defaults: the client sends only { title, template,
// dates, face_recognition.enabled } and policy (visibility, permissions,
// moderation) is applied here so a modified client can't skip it.
//
// 'vacation' is surfaced as "Trip" in UI copy — same enum value, no migration.

export type EventTemplate =
    | 'wedding'
    | 'birthday'
    | 'concert'
    | 'corporate'
    | 'vacation'
    | 'custom';

export interface TemplateDefaults {
    visibility: 'anyone_with_link' | 'invited_only' | 'private';
    permissions: {
        can_view: boolean;
        can_upload: boolean;
        can_download: boolean;
        allowed_media_types: { images: boolean; videos: boolean };
        require_approval: boolean;
    };
    /** Whether the create flow should offer the face-match (biometrics) toggle.
     *  Enabling still requires an explicit boolean from the host (DPDP). */
    face_recognition_offered: boolean;
}

const defaults = (
    requireApproval: boolean,
    faceOffered: boolean,
): TemplateDefaults => ({
    visibility: 'anyone_with_link', // QR/link sharing works immediately
    permissions: {
        can_view: true,
        can_upload: true,
        can_download: true,
        allowed_media_types: { images: true, videos: true },
        require_approval: requireApproval,
    },
    face_recognition_offered: faceOffered,
});

export const TEMPLATE_DEFAULTS: Record<EventTemplate, TemplateDefaults> = {
    // Large guest lists, mixed company → moderate before the wall; faces useful
    wedding: defaults(true, true),
    // Casual segment: zero friction, host knows everyone
    birthday: defaults(false, false),
    vacation: defaults(false, false),
    // Strangers / semi-public crowds → moderation on
    concert: defaults(true, false),
    corporate: defaults(true, true),
    custom: defaults(false, false),
};

export const getTemplateDefaults = (template: string): TemplateDefaults =>
    TEMPLATE_DEFAULTS[template as EventTemplate] ?? TEMPLATE_DEFAULTS.custom;
