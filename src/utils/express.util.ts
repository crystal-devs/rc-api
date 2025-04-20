import { Response } from "express";
import { ServiceResponse } from "types/service.types";

export const sendResponse = <T>(res: Response, serviceResponse: ServiceResponse<T>) => {
    res.status(serviceResponse.code).json(serviceResponse);
};