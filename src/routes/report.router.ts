import { addBugReportController } from "@controllers/bug-report.controller";
import express from "express";

const reportRouter = express.Router();

reportRouter.post("/bug", addBugReportController)

export default reportRouter