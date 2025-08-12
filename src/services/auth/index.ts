// 5. services/auth/index.ts - UNIFIED EXPORT
// ====================================

import { loginService } from './login.service';
import { tokenService } from './token.service';

// Main services
export { loginService } from './login.service';
export { tokenService } from './token.service';
export { userInitializationService } from './user-initialization.service';

// Export types
export type {
    LoginData,
    LoginResult,
    UserInitializationData,
    TokenPayload,
    AuthValidationResult
} from './auth.types';

// Convenience exports (backwards compatibility)
export const loginServiceFunction = loginService.login.bind(loginService);
export const generateToken = tokenService.generateToken.bind(tokenService);
export const verifyToken = tokenService.verifyToken.bind(tokenService);