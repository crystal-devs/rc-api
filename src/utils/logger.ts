import { createLogger, format, transports } from "winston";
import morgan from "morgan";

const { combine, timestamp, json, colorize, printf } = format;

// Custom format for console logging with colors
const consoleLogFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

// Create a Winston logger
export const logger = createLogger({
  level: "info",
  format: combine(colorize(), timestamp(), json()),
  transports: [
    new transports.Console({
      format: combine(colorize(), timestamp(), consoleLogFormat),
    }),
    new transports.File({ filename: "logs/app.log" }), // Store logs in a file
  ],
});

// ✅ Integrate Morgan with Winston
export const morganMiddleware = morgan("combined", {
  stream: {
    write: (message) => logger.info(message.trim()), // Sends logs directly to Winston
  },
});
