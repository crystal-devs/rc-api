import { checkSystemHealthController, dbHealthCheckController } from "@controllers/system.controller";
import express from "express";
const systemRouter = express.Router();

systemRouter.get("/", checkSystemHealthController);
systemRouter.get("/db-health", dbHealthCheckController);

export default systemRouter