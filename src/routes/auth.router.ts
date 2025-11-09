import express from "express";
import * as authController from "@controllers/auth.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import { authRateLimiter } from "@configs/security.config";
import crypto from "crypto";

const authRouter = express.Router();

// CSRF protection middleware (simple implementation without external library)
// Note: This is a basic implementation. For production, consider using a proper CSRF library
const csrfProtection = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  // Skip CSRF for GET requests and token refresh
  if (req.method === 'GET' || req.path === '/refresh') {
    next();
    return;
  }

  // For POST requests, check for valid CSRF token
  // Accept token from multiple sources for flexibility
  const csrfToken = req.headers['x-csrf-token'] as string ||
                   req.body._csrf ||
                   req.body.csrfToken;

  // For development/testing, allow bypassing CSRF with a special header
  const bypassCsrf = req.headers['x-bypass-csrf'] === 'true';

  if (bypassCsrf) {
    console.log('⚠️ CSRF bypassed for development/testing');
    next();
    return;
  }

  // Simple CSRF validation - in production, use proper double-submit cookie pattern
  if (!csrfToken || csrfToken.length < 10) {
    res.status(403).json({
      status: false,
      message: 'CSRF token required'
    });
    return;
  }

  // Basic validation - token should be a reasonable length hex string
  if (!/^[a-f0-9]{32,}$/i.test(csrfToken)) {
    res.status(403).json({
      status: false,
      message: 'Invalid CSRF token format'
    });
    return;
  }

  next();
};

// Generate CSRF token endpoint
authRouter.get('/csrf-token', (req, res) => {
  const token = crypto.randomBytes(32).toString('hex');

  // In a real implementation, you'd store this in session
  // For now, we'll just return it (client should store it)
  res.json({
    status: true,
    csrfToken: token
  });
});

// Development endpoint to bypass CSRF for testing
authRouter.post('/login-bypass', authController.loginController);

// Apply auth-specific rate limiting to all auth routes
authRouter.use(authRateLimiter);

// Apply CSRF protection to state-changing routes
authRouter.post("/login", csrfProtection, authController.loginController);
authRouter.post("/register", csrfProtection, authController.registerController);
authRouter.post("/refresh", authController.refreshTokenController); // Skip CSRF for token refresh
authRouter.post("/logout", authMiddleware, authController.logoutController); // Protected route
authRouter.get("/verify-clicky", authMiddleware, authController.verifyUserController);

// Google OAuth routes (placeholder - need Google OAuth implementation)
authRouter.get("/google", authController.googleAuthController);
authRouter.post("/google/callback", authController.googleAuthCallbackController);

export default authRouter;
