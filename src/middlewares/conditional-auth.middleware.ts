// middlewares/conditional-auth.middleware.ts

import { RequestHandler, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from './clicky-auth.middleware';
import { Event } from '@models/event.model';
import { Album } from '@models/album.model';
import { injectedRequest } from 'types/injected-types';
import jwt from "jsonwebtoken";
import { User } from '@models/user.model';


export const optionalAuthMiddleware = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            // No auth header - continue as unauthenticated user
            console.log('🔍 [optionalAuthMiddleware] No auth header - continuing as guest');
            req.user = null;
            return next();
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        if (!token) {
            // Empty token - continue as unauthenticated user
            console.log('🔍 [optionalAuthMiddleware] Empty token - continuing as guest');
            req.user = null;
            return next();
        }

        // Check if JWT_SECRET is available
        if (!process.env.JWT_SECRET) {
            console.error('❌ [optionalAuthMiddleware] JWT_SECRET not found in environment');
            req.user = null;
            return next();
        }

        // Try to verify token
        try {
            console.log('🔐 [optionalAuthMiddleware] Attempting to verify token with secret:', process.env.JWT_SECRET?.substring(0, 10) + '...');

            const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

            // Try both possible user ID fields (user_id and id)
            const userId = decoded.user_id || decoded.id;

            if (!userId) {
                console.error('❌ [optionalAuthMiddleware] No user ID found in token payload');
                req.user = null;
                return next();
            }

            console.log('🔍 [optionalAuthMiddleware] Looking up user with ID:', userId);
            const user = await User.findById(userId).select('_id name email avatar_url');

            if (user) {
                req.user = user;
                console.log(`✅ [optionalAuthMiddleware] User authenticated successfully:`, {
                    id: user._id.toString(),
                    email: user.email,
                    name: user.name
                });
            } else {
                req.user = null;
                console.log('❌ [optionalAuthMiddleware] User not found in database with ID:', userId);
            }
        } catch (tokenError: any) {
            // Invalid token - continue as unauthenticated user
            console.error('❌ [optionalAuthMiddleware] Token verification failed:', {
                error: tokenError.message,
                name: tokenError.name,
                stack: tokenError.stack
            });
            req.user = null;
        }

        next();
    } catch (error: any) {
        console.error('💥 [optionalAuthMiddleware] Unexpected error:', {
            message: error.message,
            stack: error.stack
        });
        req.user = null;
        next();
    }
};