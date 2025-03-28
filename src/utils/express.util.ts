import { Response } from "express";
import { ServiceResponse } from "types/service.types";

export const sendResponse = <T>(res: Response, serviceResponse: ServiceResponse<T>) => {
    const { code, message, data, error, other } = serviceResponse;
    res.status(code).json({ status: serviceResponse.status, message, data, error, other });
};