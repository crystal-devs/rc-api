// configs/security.config.ts - UPDATED with media-specific rate limiters
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { RequestHandler } from "express";
import { CorsOptions } from "cors";
import { keys } from "./dotenv.config";

/**
 * 🚀 Advanced Security Configuration
 * This file contains middleware configurations for securing the Express app.
 */

/** 
 * 🛡️ Helmet Security Middleware (unchanged)
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://trusted.cdn.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  frameguard: { action: "deny" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  xssFilter: true,
  noSniff: true,
  ieNoOpen: true,
});

/** 
 * 🚦 General Rate Limiting Middleware (UPDATED for better admin operations)
 */
export const rateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes window
  max: 500, // Increased from 100 to 500 for admin operations
  message: "❌ Too many requests, please try again later.",
  headers: true,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true, // Don't count failed requests
});

/** 
 * 🚦 NEW: Media-specific rate limiter
 * - More generous limits for authenticated media operations
 * - Handles bulk admin operations better
 */
export const mediaRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes window
  max: 300, // 300 requests per 5 minutes for media operations
  message: {
    error: "Too many media operations. Please wait a moment before trying again.",
    code: "MEDIA_RATE_LIMIT_EXCEEDED",
    retryAfter: 300 // 5 minutes in seconds
  },
  headers: true,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: true,
  keyGenerator: (req) => {
    // Use IP for now, can be enhanced later for user-specific limits
    return req.ip;
  }
});

/** 
 * 🚦 NEW: Bulk operations rate limiter
 * - Special limits for bulk endpoints that process multiple items
 * - Prevents abuse while allowing legitimate bulk operations
 */
export const bulkOperationsRateLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes window
  max: 30, // 30 bulk operations per 2 minutes
  message: {
    error: "Too many bulk operations. Please wait before performing more bulk actions.",
    code: "BULK_RATE_LIMIT_EXCEEDED",
    retryAfter: 120 // 2 minutes in seconds
  },
  headers: true,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: true,
  keyGenerator: (req) => {
    return req.ip;
  }
});

/** 
 * 🚦 NEW: Upload rate limiter
 * - Special limits for file uploads
 * - More restrictive to prevent abuse
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 50, // 50 upload requests per minute
  message: {
    error: "Too many upload attempts. Please wait before uploading more files.",
    code: "UPLOAD_RATE_LIMIT_EXCEEDED",
    retryAfter: 60
  },
  headers: true,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: true,
});

/** 
 * 🕵️‍♂️ CORS Configuration (unchanged)
 */
export const corsOptions: CorsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) {
    if (!origin || (Array.isArray(keys.corsOrigins) && keys.corsOrigins.includes(origin))) {
      callback(null, true);
    } else {
      callback(new Error("❌ Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "If-Modified-Since"],
  credentials: true,
};