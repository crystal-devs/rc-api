import dotenv from "dotenv";
import { logger } from "@utils/logger";

dotenv.config(); // Load .env before anything else

// ✅ Extract environment variables
export const keys: Record<string, string | number | string[]> = {
  port: process.env.PORT ? Number(process.env.PORT) : 8080, // Ensure it's a number
  nodeEnv: process.env.NODE_ENV || "development",
  mongoURI: process.env.MONGO_URI,
  mongoDBName: process.env.MONGO_DB_NAME,
  appLiveVersion: process.env.VERSION,
  // ✅ Convert CORS_ORIGINS from a comma-separated string to an array
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : [],
};

// ✅ Validate environment variables
const requiredKeys = ["port", "mongoURI", "mongoDBName", "appLiveVersion"];
const missingKeys = requiredKeys.filter((key) => !keys[key]);

if (missingKeys.length) {
  logger.error(`❌ Missing required environment variables: ${missingKeys.join(", ")}`);
  process.exit(1); // 💀 Kill process if missing env vars
}

// ✅ Secure Logging (Hides sensitive data)
logger.info("✅ Environment Variables Loaded:");
requiredKeys.forEach((key) => {
  const value = key.includes("mongo") ? "***HIDDEN***" : keys[key]; // Hide Mongo credentials
  logger.info(`   - ${key}: ${value}`);
});
