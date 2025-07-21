export const MODEL_NAMES = {
    USER: "users",
    ROLE: "roles",
    EVENT: "events",
    ALBUM: "albums",
    MEDIA: "medias",
    ACCESS_CONTROL: "access-controls",
    ACTIVITY_LOG: "activity-logs",
    SHARE_TOKEN: "share-tokens",
    USER_SUBSCRIPTION: "user-subscriptions",
    USER_USAGE: "user-usages",
    SUBSCRIPTION_PLAN: "subscription-plans",
    EVENT_PARTICIPANT: "event-participants",
    EVENT_SESSION: "event-sessions",
} as const;

export const getModelName = (model: keyof typeof MODEL_NAMES) => MODEL_NAMES[model];
