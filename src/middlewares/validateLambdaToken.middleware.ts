import { NextFunction, Request, Response } from "express";

// middleware/validateLambdaToken.ts
export const validateLambdaToken = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers.authorization?.split(' ')[1];
    console.log('Validating Lambda token:', token);
    if (token !== process.env.BACKEND_API_TOKEN) {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    next();
};