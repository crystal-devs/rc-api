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
 * 🛡️ Helmet Security Middleware
 * - Prevents well-known web vulnerabilities
 * - Protects against XSS, clickjacking, and MIME-type sniffing
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://trusted.cdn.com"], // Allow self-hosted and a trusted CDN
      objectSrc: ["'none'"], // Prevent embedding <object> and <embed> elements
      upgradeInsecureRequests: [],
    },
  },
  frameguard: { action: "deny" }, // Prevents clickjacking
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }, // Enforce HTTPS
  xssFilter: true, // Helps prevent cross-site scripting (XSS) attacks
  noSniff: true, // Prevents browsers from MIME-type sniffing
  ieNoOpen: true, // Blocks download options in Internet Explorer
});

/** 
 * 🚦 Rate Limiting Middleware
 * - Prevents brute force attacks & DDoS attempts
 * - Limits requests from a single IP
 */
export const rateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes window
  max: 100, // Max 100 requests per IP
  message: "❌ Too many requests, please try again later.",
  headers: true, // Send Rate-Limit headers
});

/** 
 * 🕵️‍♂️ CORS Configuration
 * - Restricts allowed origins & headers
 * - Prevents unauthorized cross-origin access
 */
export const corsOptions: CorsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) {
    if (!origin || (Array.isArray(keys.corsOrigins) && keys.corsOrigins.includes(origin))) {
      // ✅ Allowed origin (including non-browser tools like curl/Postman)
      callback(null, true);
    } else {
      // ❌ Not allowed
      callback(new Error("❌ Not allowed by CORS"));
    }
  },

  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true, // ✅ Allow cookies & auth headers
};
