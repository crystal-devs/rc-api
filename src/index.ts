import { corsOptions } from "@configs/cors.config";
import { keys } from "@configs/keys.config";
import { connectToMongoDB } from "@configs/mongodb.config";
import { gracefulShutdown } from "@configs/shutdown.config";
import { logGojo } from "@utils/gojo-satoru";
import { logger, morganMiddleware } from "@utils/logger";

import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import http from "http";

const app = express();
const PORT = keys.port
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

connectToMongoDB()

app.use(limiter);//It prevents DDoS (Distributed Denial of Service) attacks, brute-force attempts, and spam by blocking excessive requests.
app.use(cors(corsOptions));
app.use(helmet()); //Protects against XSS, clickjacking, and other web attacks.
app.use(compression());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// morgan stuffs
app.use(morganMiddleware); // No need to manually split logs
const server = http.createServer(app);


server.listen(PORT, () => {
  logger.info(`🚀 Server running at http://localhost:${PORT}/`);
  logGojo(); // 🔥 YEYE GOJO TIME!
});


// ⛔ Graceful Shutdown
gracefulShutdown(server);
