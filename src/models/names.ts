export const MODEL_NAMES = {
    USER: "users",
    ROLE: "roles",
    EVENT: "events",
    ALBUM: "albums",
    MEDIA: "medias",
    ACCESS_CONTROL: "access-controls",
    ACTIVITY_LOG: "activity-logs",
    SHARE_TOKEN: "share-tokens",
} as const;

export const getModelName = (model: keyof typeof MODEL_NAMES) => MODEL_NAMES[model];
