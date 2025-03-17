import express from "express";
import { loginController } from "@controllers/auth.controller";

const authRouter = express.Router();

// Route for login/signup
authRouter.post("/login", loginController);

export default authRouter;
