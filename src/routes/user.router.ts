import express from "express";
import * as userController from "@controllers/user.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";

const userRouter = express.Router();

// User profile routes
userRouter.get("/profile", authMiddleware, userController.getUserProfileController);
userRouter.get("/subscription", authMiddleware, userController.getUserSubscriptionController);
userRouter.get("/usage", authMiddleware, userController.getUserUsageController);
userRouter.get("/statistics", authMiddleware, userController.getUserStatisticsController);

// Subscription management routes
userRouter.post("/subscription/upgrade", authMiddleware, userController.upgradeSubscriptionController);
userRouter.get("/subscription/plans", userController.getSubscriptionPlansController); // Public endpoint

export default userRouter;
