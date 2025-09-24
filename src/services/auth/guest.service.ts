import { v4 as uuidv4 } from 'uuid';
import { ServiceResponse } from "@services/user";

export const createGuestSessionService = async () : Promise<ServiceResponse<any>> => {
    try {
        const sessionId = uuidv4();
        return {
            status: true,
            message: "Guest session created successfully",
            data: sessionId
        };
    } catch (error) {
        return {
            status: false,
            message: "Failed to create guest session",
            data: null
        };
    }
}
    
