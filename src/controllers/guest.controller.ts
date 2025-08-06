import { Response, NextFunction } from "express";
import { sendResponse } from "@utils/express.util";
import { injectedRequest } from "types/injected-types";

/**
 * Get the list of invited guests for a share token
 */
export const getInvitedGuestsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token_id } = req.params;
        const userId = req.user._id.toString();
        
        // Get the guest list
        // const response = await getInvitedGuestsService(token_id, userId);
        
        // Send response
        // return sendResponse(res, response);
        return 
    } catch (error: any) {
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Failed to retrieve invited guests",
            data: null,
            error: { message: error.message },
            other: null
        });
    }
};
