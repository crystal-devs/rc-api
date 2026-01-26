import { Response, NextFunction } from "express";
import { injectedRequest } from "types/injected-types";
import { getUserByIdService } from "@services/user";
import { tokenService } from "@services/auth";

export const authMiddleware = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    console.log('===== AUTH MIDDLEWARE =====');
    // Skip authorization check for OPTIONS requests (CORS preflight)
    if (req.method === 'OPTIONS') {
        next();
        return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader) {
        console.log('Authorization header missing')
        res.status(401).json({ message: "Authorization header missing" });
        return; // Ensure the function returns void
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        res.status(401).json({ message: "Token missing" });
        return; // Ensure the function returns void
    }

    try {
        const tokenResult = await tokenService.verifyToken(token);
        if (!tokenResult.valid || !tokenResult.user) {
            res.status(401).json({ message: tokenResult.error || "Invalid token" });
            return;
        }

        const user = await getUserByIdService(tokenResult.user.id);
        req.user = user;

        next();
    } catch (error) {
        res.status(401).json({ message: "Authentication failed" });
        return;
    }
}

