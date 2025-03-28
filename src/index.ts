import { connectToMongoDB } from "@configs/database.config";
import { keys } from "@configs/dotenv.config";
import { corsOptions, rateLimiter, securityHeaders } from "@configs/security.config";
import { gracefulShutdown } from "@configs/shutdown.config";
import { globalErrorHandler } from "@middlewares/error-handler.middleware";
import authRouter from "@routes/auth-router";
import systemRouter from "@routes/system.route";
import { logGojo } from "@utils/gojo-satoru";
import { logger, morganMiddleware } from "@utils/logger";

import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import http from "http";
import roleMasterModel from "@models/master/role.master.model";

const app = express();
const PORT = keys.port;
const VERSION = keys.APILiveVersion;

//- middlewares 🍉
// 🚀 1️⃣ Performance & Parsing Middlewares
app.use(compression());// ✅ Compresses Response Data for Faster Load Times
app.use(cookieParser());// ✅ Parses Cookies in Requests (Required for Authentication)
app.use(express.json());// ✅ Parses JSON Request Bodies
app.use(express.urlencoded({ extended: true }));// ✅ Parses URL-encoded Data (Form Submissions)

// 🚀 2️⃣ Security Middlewares (Protects the App from Attacks)
app.use(securityHeaders);// ✅ Security Headers (Prevents Clickjacking, XSS, etc.)
app.use(rateLimiter);// ✅ Rate Limiting (Prevents API abuse & DDoS)
app.use(cors(corsOptions));// ✅ Cross-Origin Requests Allowed Only for Trusted Domains

// 🚀 3️⃣ Logging & Debugging
app.use(morganMiddleware); // ✅ Structured Logging for Debugging & Monitoring

const server = http.createServer(app);

function startServer() {
  try {
    server.listen(PORT, () => {
      logger.info(`🚀 Server running at http://localhost:${PORT}/`);
      if (keys.nodeEnv === "development") logGojo(); // 🔥 YEYE GOJO TIME!
    });
  } catch (error) {
    logger.error("❌ Failed to start Server", error);
    process.exit(1);
  }
}

// 🌐 express routes
app.use("/system", systemRouter)
app.use(`/api/${VERSION}/auth`, authRouter)

roleMasterModel.find()


connectToMongoDB().then(startServer).catch((err) => {
  logger.error("mongodb connection failed: ", err)
  process.exit(1); // 💀 No point in running the server if DB is dead
})

// 🌗 error middleware should we written in the last
app.use(globalErrorHandler); // 🛠 Express error-handling middleware should always be the last middleware.
// ❓Why? Because if an error occurs in routes/middleware, Express needs to pass it down to the error handler,

// ⛔ Graceful Shutdown
gracefulShutdown(server);

// 🌍 Process-wide Error Handling (Catches Fatal Errors)
process.on("uncaughtException", (err) => {
  logger.error("⚠️ Uncaught Exception!", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.warn("⚠️ Unhandled Promise Rejection", reason);
});