export const MODEL_NAMES = {
    USER: "users",
    ROLE: "roles",
    EVENT: "events",
    ALBUM: "albums",
    MEDIA: "medias",
    ACCESS_CONTROL: "access_controls",
    ACTIVITY_LOG: "activity_logs",
    USER_SUBSCRIPTION: "user_subscriptions",
    USER_USAGE: "user_usages",
    SUBSCRIPTION_PLAN: "subscription_plans",
    EVENT_PARTICIPANT: "event_participants",
    EVENT_SESSION: "event_sessions",
    PHOTO_WALL: "photo_wall",
    BULK_DOWNLOAD: 'bulk_downloads',
    GUEST_SESSION: 'guest_sessions',
    EVENT_INVITATION: 'event_invitation'
} as const;

export const getModelName = (model: keyof typeof MODEL_NAMES) => MODEL_NAMES[model];
