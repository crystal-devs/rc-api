import dotenv from "dotenv";
dotenv.config();

export const keys = {
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,
  mongoURI: process.env.MONGO_URI,
  mongoDBName: process.env.MONGO_DB_NAME,
  appLiveVersion: process.env.VERSION,
  corsOrigins: process.env.CORS_ORIGINS?.split(",") || [], // Convert to array here ✅
};
