import { Request, Response, NextFunction } from "express";
import { logger } from "@utils/logger";

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

  // Check if the error has an explicit status code (e.g., thrown manually)
  const statusCode = err.status || 500;
  const errorMessage = err.message || "Internal Server Error";

  // Construct response object
  const response: ErrorResponse = {
    success: false,
    message: errorMessage,
    status: statusCode,
  };

  // Show stack trace ONLY in development mode (hide in production) 
  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
  }

  // Send JSON response
  res.status(statusCode).json(response);
};
