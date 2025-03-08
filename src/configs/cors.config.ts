import cors from "cors";
import { keys } from "./keys.config";

  export const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      if (!origin || keys.corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };
