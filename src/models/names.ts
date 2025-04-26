export const MODEL_NAMES = {
    USER: "users",
    ROLE: "roles",
    EVENT: "events",
    ALBUM: "albums",
    MEDIA: "medias",
    ACCESS_CONTROL: "access-controls",
    ACTIVITY_LOG: "activity-logs",
} as const;

export const getModelName = (model: keyof typeof MODEL_NAMES) => MODEL_NAMES[model];
