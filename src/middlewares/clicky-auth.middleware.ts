import jwt from "jsonwebtoken";
import { Response, NextFunction } from "express";
import { keys } from "@configs/dotenv.config";
import { getUserByIdService } from "@services/user.service";
import { injectedRequest } from "types/injected-types";

export const authMiddleware = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    console.log('===== AUTH MIDDLEWARE =====');
    // Skip authorization check for OPTIONS requests (CORS preflight)
    if (req.method === 'OPTIONS') {
        next();
        return;
    }
    
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        res.status(401).json({ message: "Authorization header missing" });
        return; // Ensure the function returns void
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        res.status(401).json({ message: "Token missing" });
        return; // Ensure the function returns void
    }

    try {
        const decoded: { user_id?: string } = jwt.verify(token, keys.jwtSecret as string) as { user_id?: string };
        if (!decoded || !decoded.user_id) {
            res.status(401).json({ message: "Invalid token" });
            return; // Ensure the function returns void
        }
        const user = await getUserByIdService(decoded.user_id);
        req.user = user;
        console.log(user);
        next(); // Pass control to the next middleware
    } catch (error) {
        res.status(403).json({ message: "Invalid or expired token" });
        return; // Ensure the function returns void
    }
}

