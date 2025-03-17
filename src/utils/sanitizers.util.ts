export const trimObject = (obj: Record<string, any>): Record<string, any> => {
    try {
        if (!obj || typeof obj !== "object") return obj;

        return Object.entries(obj).reduce<Record<string, any>>((acc, [key, value]) => {
            acc[key] = typeof value === "string" ? value.trim() : value;
            return acc;
        }, {});
    } catch (error) {
        console.error("TRIM_OBJECT_HELPER_ERROR:", error);
        return obj;
    }
};
