import { logger } from "@utils/logger";
import mongoose from "mongoose";

// Delay in milliseconds before forced exit
const FORCE_EXIT_DELAY = 10_000; // Same as 10000, but more readable

export async function gracefulShutdown(server: import("http").Server) {
    try {

        process.on("SIGINT", async () => {

            logger.warn("🔴 Graceful shutdown initiated... Cleaning up resources.");

            // Close active database connections
            await mongoose.connection.close(); // 🛑 Close the DB connection
            logger.info("✅ MongoDB connection closed.");

            // Stop the HTTP server
            server.close(() => {
                logger.info("✅ HTTP server closed successfully.");
                process.exit(0); // Normal exit
            });

            // 🔥 If shutdown takes too long, force exit (fallback)
            setTimeout(() => {
                logger.error("⏳ Shutdown taking too long! Forcing exit...");
                process.exit(1); // Force exit with error code
            }, FORCE_EXIT_DELAY);
        })

    } catch (error) {
        logger.error("❌ Error during shutdown:", error);
        process.exit(1); // Exit with failure
    }
}
