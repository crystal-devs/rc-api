export type ServiceResponse<T> = {
    status: boolean;
    code: number;
    message: string;
    data: T | null;
    other?: any;
    error: { message: string; stack?: string } | null;
    stack?: any,
}