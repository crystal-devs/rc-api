import { keys } from "@configs/dotenv.config";
import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { logger } from "@utils/logger";
import { securityMonitor } from "@services/system/monitoring.service";

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
        const status = ["🔴 Disconnected", "🟢 Connected", "🟡 Connecting", "🟠 Disconnecting", "🔴 Invalid Creds"];

        res.status(200).json({
            dbStatus: status[mongoState],
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        next(err)
    }
};

// 🛡️ Security Violation Report (CSP, etc.)
export const securityReportController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const violation = req.body;

        // Log security violations using the security monitor
        securityMonitor.logEvent('csp_violation', 2, {
            violatedDirective: violation.violatedDirective,
            blockedUri: violation.blockedUri,
            sourceFile: violation.sourceFile,
            lineNumber: violation.lineNumber,
            columnNumber: violation.columnNumber,
            documentUri: violation.documentUri,
            originalPolicy: violation.originalPolicy,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        // Return 204 No Content for CSP reports
        res.status(204).send();
    } catch (err) {
        logger.error('Error processing security report', err);
        next(err);
    }
};