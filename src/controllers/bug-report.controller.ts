import { addBugReportService } from "@services/bug-report.service";
import { sendResponse } from "@utils/express.util";
import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, RequestHandler, Response } from "express";
import { injectedRequest } from "types/injected-types";

export const addBugReportController: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try{
        const response = await addBugReportService(trimObject(req.body))
        sendResponse(res, response)
        return
    }catch(error: any){
        next(error);
    }
}