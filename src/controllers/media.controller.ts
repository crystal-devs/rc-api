import { uploadMediaToImageKitService } from "@services/media.service";
import { sendResponse } from "@utils/express.util";
import { NextFunction, RequestHandler, Response } from "express";
import { injectedRequest } from "types/injected-types";

export const uploadMediaToImageKitController: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const file = req.file;
        const { album_id, page_id, user_id } = req.body;

        if (!file || !album_id || !user_id) {
            res.status(400).json({ status: false, message: "Missing required fields" });
            return
        }
        const response = await uploadMediaToImageKitService(file, user_id, album_id, page_id)
        sendResponse(res, response)
        return
    } catch (_err) {
        next(_err)
    }
}