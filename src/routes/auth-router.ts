import express from "express";
import * as authController from "@controllers/auth.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
const authRouter = express.Router();

// Route for login/signup
authRouter.post("/login", authController.loginController);
authRouter.get("/verify-clicky", authMiddleware, authController.verifyUserController);

authRouter.post("/create-guest-session", authController.createGuestSessionController);

export default authRouter;  
