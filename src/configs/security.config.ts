// configs/security.config.ts - UPDATED with media-specific rate limiters
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { RequestHandler } from "express";
import { CorsOptions } from "cors";
import { keys } from "./dotenv.config";
import { logger } from "@utils/logger";
import { securityMonitor } from "@services/system/monitoring.service";

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
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Allow for React dev, restrict in prod
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.", "wss:", "ws:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      // upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : undefined, // Temporarily disabled
      reportUri: '/api/v1/system/security-report'
    },
    reportOnly: process.env.NODE_ENV !== 'production' // Report violations in dev, enforce in prod
  },
  frameguard: { action: "deny" },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  xssFilter: true,
  noSniff: true,
  ieNoOpen: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
});

/**
 * 🚦 General Rate Limiting Middleware (UPDATED for better admin operations)
 * - Overall application rate limiting to prevent bot attacks
 * - Applied globally to all routes
 */
export const rateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window (stricter for bot protection)
  max: 200, // 200 requests per minute per IP (reasonable for normal users)
  message: {
    error: "Too many requests. Please slow down.",
    code: "GLOBAL_RATE_LIMIT_EXCEEDED",
    retryAfter: 60
  },
  headers: true,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true, // Don't count failed requests
  skipSuccessfulRequests: false, // Count all successful requests
  keyGenerator: (req) => {
    // Use IP address for global limiting
    return req.ip;
  }
});

/**
 * 🔐 Auth-Specific Rate Limiting Middleware
 * - Stricter limits for authentication endpoints
 * - Prevents brute force attacks
 */
export const authRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window (relaxed)
  max: 200, // 200/min for dev
  message: {
    error: "Too many login attempts. Please wait 15 minutes before trying again.",
    code: "AUTH_RATE_LIMIT_EXCEEDED",
    retryAfter: 60 // 1 minute
  },
  headers: true,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against limit
  keyGenerator: (req) => {
    // Use IP + User-Agent for better protection against distributed attacks
    return `${req.ip}-${req.get('User-Agent')?.substring(0, 50) || 'unknown'}`;
  }
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
 * 🚦 NEW: Bulk Delete rate limiter
 * - More restrictive for destructive operations
 */
export const bulkDeleteRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Max 10 bulk delete operations per window
  message: {
    error: "Too many bulk delete requests. Please wait 5 minutes before trying again.",
    code: "BULK_DELETE_RATE_LIMIT_EXCEEDED",
    retryAfter: 300 // 5 minutes in seconds
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
 * 🚦 NEW: General Bulk rate limiter
 * - For status checks and history
 */
export const generalBulkRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Max 60 requests per minute
  message: {
    error: "Too many requests. Please wait before trying again.",
    code: "GENERAL_BULK_RATE_LIMIT_EXCEEDED",
    retryAfter: 60
  },
  headers: true,
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * 🚦 NEW: Bulk Download Creation rate limiter
 * - Very restrictive as it triggers heavy jobs
 */
export const createBulkDownloadRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // Max 3 requests per window per IP
  message: {
    error: "Too many download requests. Please wait 5 minutes before trying again.",
    code: "BULK_DOWNLOAD_RATE_LIMIT_EXCEEDED",
    retryAfter: 300
  },
  headers: true,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    return req.ip;
  }
});

/**
 * 🚦 NEW: Bulk Download Status rate limiter
 * - For polling status
 */
export const bulkDownloadStatusRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Max 30 status checks per minute
  message: {
    error: "Too many status requests. Please wait.",
    code: "BULK_DOWNLOAD_STATUS_RATE_LIMIT_EXCEEDED",
    retryAfter: 60
  }
});

/**
 * 🎯 Advanced Endpoint-Specific Rate Limiting
 * - Per-endpoint limits based on resource sensitivity
 * - IP-based tracking with optional user-based limits
 * - Different limits for different HTTP methods
 */

// Rate limit configurations per endpoint pattern
export const endpointRateLimits: Record<string, any> = {
  // Auth endpoints - relaxed for testing
  '/api/v1/auth/login': { windowMs: 15 * 60 * 1000, max: 100, method: 'POST' },
  '/api/v1/auth/refresh': { windowMs: 5 * 60 * 1000, max: 10, method: 'POST' },
  '/api/v1/auth/csrf-token': { windowMs: 1 * 60 * 1000, max: 30, method: 'GET' },

  // User profile endpoints
  '/api/v1/user': { windowMs: 1 * 60 * 1000, max: 60 },
  '/api/v1/user/subscription': { windowMs: 5 * 60 * 1000, max: 100 },
  '/api/v1/user/usage': { windowMs: 5 * 60 * 1000, max: 50 },

  // Event CRUD operations
  '/api/v1/event': {
    POST: { windowMs: 5 * 60 * 1000, max: 20 }, // Create events
    PUT: { windowMs: 2 * 60 * 1000, max: 50 },  // Update events
    DELETE: { windowMs: 10 * 60 * 1000, max: 10 } // Delete events
  },

  // Media operations - resource intensive
  '/api/v1/media': {
    POST: { windowMs: 1 * 60 * 1000, max: 30 }, // Upload media
    PUT: { windowMs: 2 * 60 * 1000, max: 100 }, // Update media
    DELETE: { windowMs: 5 * 60 * 1000, max: 50 } // Delete media
  },

  // Bulk operations - very restrictive
  '/api/v1/bulk': { windowMs: 2 * 60 * 1000, max: 5 },

  // Search and listing endpoints
  '/api/v1/event/*/media': { windowMs: 30 * 1000, max: 20 }, // 30 seconds
  '/api/v1/album': { windowMs: 30 * 1000, max: 30 },

  // Admin endpoints - most restrictive
  '/api/v1/admin': { windowMs: 10 * 60 * 1000, max: 50 },

  // WebSocket connections
  '/socket.io': { windowMs: 1 * 60 * 1000, max: 100 }
};

/**
 * 🎯 Dynamic Endpoint Rate Limiter Factory
 * Creates rate limiters based on endpoint patterns and HTTP methods
 */
export const createEndpointRateLimiter = (endpoint: string, method: string = 'GET') => {
  // Find matching endpoint configuration
  const config = findEndpointConfig(endpoint, method);

  if (!config) {
    // Default rate limiter for unmatched endpoints
    return rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 100, // 100 requests per minute
      message: {
        error: "Too many requests to this endpoint",
        code: "ENDPOINT_RATE_LIMIT_EXCEEDED",
        retryAfter: 60
      },
      headers: true,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: any) => {
        // Use combination of IP and User ID if authenticated
        const userId = req.user?._id?.toString() || 'anonymous';
        return `${req.ip}-${userId}`;
      }
    });
  }

  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: {
      error: `Too many requests to ${endpoint}`,
      code: "ENDPOINT_RATE_LIMIT_EXCEEDED",
      retryAfter: Math.ceil(config.windowMs / 1000),
      endpoint,
      method
    },
    headers: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => {
      // Enhanced key generation: IP + User ID + Endpoint
      const userId = req.user?._id?.toString() || 'anonymous';
      const endpointKey = endpoint.replace(/\/api\/v1\//, '').replace(/\//g, '_');
      return `${req.ip}-${userId}-${endpointKey}`;
    },
    skipSuccessfulRequests: false,
    skipFailedRequests: true,
    handler: (req: any, res: any) => {
      const retryAfter = Math.ceil(config.windowMs / 1000);
      res.status(429).json({
        status: false,
        message: `Rate limit exceeded for ${endpoint}. Try again in ${retryAfter} seconds.`,
        code: "ENDPOINT_RATE_LIMIT_EXCEEDED",
        retryAfter,
        endpoint,
        method
      });
    }
  });
};

/**
 * 🔍 Find endpoint configuration based on pattern matching
 */
function findEndpointConfig(endpoint: string, method: string): any {
  // Direct match
  if (endpointRateLimits[endpoint]) {
    const config = endpointRateLimits[endpoint];
    if (typeof config === 'object' && config.windowMs === undefined) {
      // Method-specific config
      return config[method] || config['GET'] || config['POST'];
    }
    return config;
  }

  // Pattern matching for dynamic routes
  for (const [pattern, config] of Object.entries(endpointRateLimits)) {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '[^/]+'));
      if (regex.test(endpoint)) {
        if (typeof config === 'object' && config.windowMs === undefined) {
          return config[method] || config['GET'] || config['POST'];
        }
        return config;
      }
    }
  }

  return null;
}

/**
 * 📊 Rate Limit Monitoring Middleware
 * Logs rate limit hits for monitoring and analytics
 */
export const rateLimitLogger = (req: any, res: any, next: any) => {
  // Check if request was rate limited
  if (res.statusCode === 429) {
    securityMonitor.logEvent('rate_limit_hit', 2, {
      endpoint: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userId: req.user?._id?.toString() || 'anonymous',
      userAgent: req.get('User-Agent')
    });
  }
  next();
};

/**
 * 🤖 Bot Detection Middleware
 * Additional layer to detect and block automated requests
 */
export const botDetectionMiddleware = (req: any, res: any, next: any) => {
  const userAgent = req.get('User-Agent') || '';
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /python/i,
    /curl/i,
    /wget/i,
    /postman/i, // Block Postman for production
  ];

  // Check for suspicious user agents
  const isSuspiciousUA = suspiciousPatterns.some(pattern => pattern.test(userAgent));

  // Check for rapid successive requests (basic bot detection)
  const now = Date.now();
  const lastRequestTime = req.ipLastRequest || 0;
  const timeDiff = now - lastRequestTime;

  // If requests are coming too fast (< 100ms apart), flag as suspicious
  const isTooFast = timeDiff < 100;

  // Store request time for next check
  req.ipLastRequest = now;

  if (isSuspiciousUA && isTooFast) {
    securityMonitor.logEvent('bot_detected', 4, {
      ip: req.ip,
      userAgent,
      endpoint: req.originalUrl,
      timeDiff,
      reason: 'Suspicious user agent + rapid requests'
    });

    // For suspicious requests, add extra delay
    setTimeout(() => {
      res.status(429).json({
        status: false,
        message: 'Request blocked due to suspicious activity',
        code: 'BOT_DETECTION_BLOCKED'
      });
    }, 2000); // 2 second delay

    return;
  }

  next();
};

/**
 * ️‍♂️ CORS Configuration (updated for CSRF support)
 */
export const corsOptions: CorsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
      return;
    }

    // Check configured origins
    if (Array.isArray(keys.corsOrigins) && keys.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("❌ Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "If-Modified-Since",
    "x-csrf-token",
    "x-expected-csrf",
    "x-bypass-csrf",
    "Cache-Control", // Allow cache control headers
    "Pragma",        // Allow pragma headers
    "X-Requested-With", // Allow standard AJAX header
    "Accept-Encoding" // Allow explicit encoding requests
  ],
  credentials: true,
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
};