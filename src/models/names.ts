export const MODEL_NAMES = {
    USER: "users",
    ROLE: "roles",
    ALBUM: "albums",
    PAGE: "pages",
    MEDIA: "medias",
    ACCESS_CONTROL: "access-controls",
    ACTIVITY_LOG: "activity-logs",
} as const;

export const getModelName = (model: keyof typeof MODEL_NAMES) => MODEL_NAMES[model];
