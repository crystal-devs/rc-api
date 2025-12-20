import { checkSystemHealthController, dbHealthCheckController, securityReportController } from "@controllers/system.controller";
import express from "express";
const systemRouter = express.Router();

systemRouter.get("/", checkSystemHealthController);
systemRouter.get("/db-health", dbHealthCheckController);
systemRouter.post("/security-report", securityReportController);

export default systemRouter