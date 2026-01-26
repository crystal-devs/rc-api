import express from "express";
import * as authController from "@controllers/auth.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import { authRateLimiter } from "@configs/security.config";
import { csrfProtection, generateCSRFTokenHandler } from "@middlewares/csrf.middleware";

const authRouter = express.Router();

// ============================================================================
// CSRF Token Endpoint (Industry Standard: HMAC-signed tokens)
// ============================================================================
authRouter.get('/csrf-token', generateCSRFTokenHandler);

// ============================================================================
// Development bypass endpoint (remove in production)
// ============================================================================
if (process.env.NODE_ENV === 'development') {
  authRouter.post('/login-bypass', authController.loginController);
}

// ============================================================================
// Apply rate limiting to all auth routes
// ============================================================================
authRouter.use(authRateLimiter);

// ============================================================================
// Authentication Routes
// ============================================================================
// CSRF protected routes (state-changing operations)
authRouter.post("/login", csrfProtection, authController.loginController);
authRouter.post("/register", csrfProtection, authController.registerController);
authRouter.post("/logout", authMiddleware, csrfProtection, authController.logoutController);

// Token refresh - uses HttpOnly cookie, no CSRF needed
authRouter.post("/refresh", authController.refreshTokenController);

// Verification endpoint
authRouter.get("/verify-clicky", authMiddleware, authController.verifyUserController);

// ============================================================================
// OAuth Routes
// ============================================================================
authRouter.get("/google", authController.googleAuthController);
authRouter.post("/google/callback", csrfProtection, authController.googleAuthCallbackController);

export default authRouter;

