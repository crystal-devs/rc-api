import { Request, Response, NextFunction, RequestHandler } from "express";
import * as authService from "@services/auth.service"
import { trimObject } from "@utils/sanitizers.util";

export const loginController: RequestHandler = async (req, res, next) => {
    try {
        const { email, password, phone_number, name, profile_pic } = trimObject(req.body);

        console.log({ email, password, phone_number, name, profile_pic })
        console.log(req.body)

        if (!password || (!email && !phone_number)) {
             res.status(400).json({
                status: false,
                message: "Password and either email or phone number are required for login!",
            });
            return
        }

        const response = await authService.loginService({
            email,
            password,
            phone_number,
            name,
            profile_pic,
        });

         res.status(200).json(response);
         return
    } catch (err) {
        next(err);
    }
};
