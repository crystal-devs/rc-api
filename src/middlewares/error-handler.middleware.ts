import { Request, Response, NextFunction } from "express";
import { logger } from "@utils/logger";
import { sendResponse } from "@utils/express.util";

// Standard Error Response Format
interface ErrorResponse {
  success: boolean;
  message: string;
  status?: number;
  stack?: string;
}

// Central Error Handling Middleware
export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error("❌ Global Error Caught:", err);

  if(process.env.NODE_ENV === "development") logger.error(err.stack);

  // Send JSON response
  sendResponse(res, {
    status: false,
    code: err.status || 500,
    data: null,
    error: err,
    message: err.message || "Internal Server error",
    other: null,
    stack: process.env.NODE_ENV === "development" ? err.stack : null,
  })
};
