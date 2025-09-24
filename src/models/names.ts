export const MODEL_NAMES = {
    USER: "users",
    ROLE: "roles",
    EVENT: "events",
    ALBUM: "albums",
    MEDIA: "medias",
    ACCESS_CONTROL: "access-controls",
    ACTIVITY_LOG: "activity-logs",
    USER_SUBSCRIPTION: "user-subscriptions",
    USER_USAGE: "user-usages",
    SUBSCRIPTION_PLAN: "subscription-plans",
    EVENT_PARTICIPANT: "event-participants",
    EVENT_SESSION: "event-sessions",
    PHOTO_WALL: "photo-wall",
    BUG_REPORT: "bug-reports",
} as const;

export const getModelName = (model: keyof typeof MODEL_NAMES) => MODEL_NAMES[model];
