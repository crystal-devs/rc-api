import express from "express";
import * as userController from "@controllers/user.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import { claimFaceIdentityController, getGlobalMemoriesController, deleteFaceIdentityController } from "@controllers/user/user-identity.controller";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

const userRouter = express.Router();

// User profile routes
userRouter.get("/profile", authMiddleware, userController.getUserProfileController);
userRouter.get("/subscription", authMiddleware, userController.getUserSubscriptionController);
userRouter.get("/usage", authMiddleware, userController.getUserUsageController);
userRouter.get("/statistics", authMiddleware, userController.getUserStatisticsController);

// Subscription management routes
userRouter.post("/subscription/upgrade", authMiddleware, userController.upgradeSubscriptionController);
userRouter.get("/subscription/plans", userController.getSubscriptionPlansController); // Public endpoint

// Identity Routes (Phase 4)
userRouter.post("/identity/face", authMiddleware, upload.single('selfie'), claimFaceIdentityController as unknown as express.RequestHandler);
userRouter.get("/memories", authMiddleware, getGlobalMemoriesController as unknown as express.RequestHandler);
userRouter.delete("/identity/face", authMiddleware, deleteFaceIdentityController as unknown as express.RequestHandler);

export default userRouter;
