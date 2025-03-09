import { keys } from "@configs/dotenv.config";
import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";

// ✅ System Health Check (For DevOps/Debugging)
export const checkSystemHealthController = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        res.status(200).json({
            status: "✅ Running Smoothly",
            uptime: process.uptime(), // 🔄 Server uptime in seconds
            memoryUsage: process.memoryUsage(), // 🧠 Memory usage (heap, rss, etc.)
            environment: keys.nodeEnv, // 🌎 Dev, Prod, etc.
            timestamp: new Date().toISOString(),
            liveAPIVersion: keys.APILiveVersion,
        });
    } catch (err) {
        next(err)
    }
}

// ✅ Database Connection Check
export const dbHealthCheckController = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const mongoState = mongoose.connection.readyState;
        const status = ["🔴 Disconnected","🟢 Connected", "🟡 Connecting",  "🟠 Disconnecting", "🔴 Invalid Creds"];

        res.status(200).json({
            dbStatus: status[mongoState],
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        next(err)
    }
};