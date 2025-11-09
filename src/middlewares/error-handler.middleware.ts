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
  const statusCode = err.status || 500;
  let message = err.message || "Internal Server Error";

  // Enhanced security logging for auth-related errors
  if (req.path.includes('/auth/') || req.path.includes('/login')) {
    logger.warn("Authentication error:", {
      message: err.message, // Log actual error for debugging
      statusCode,
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      // Don't log sensitive data
    });
  } else {
    logger.error("❌ Global Error Caught:", err);
    if(process.env.NODE_ENV === "development") logger.error(err.stack);
  }

  // Sanitize error messages for security - don't leak internal details
  if (statusCode === 500) {
    message = "Internal Server Error";
  }

  // Send JSON response
  sendResponse(res, {
    status: false,
    code: statusCode,
    data: null,
    error: null, // Don't send error object in production
    message: message,
    other: null,
    stack: process.env.NODE_ENV === "development" ? err.stack : null,
  })
};
