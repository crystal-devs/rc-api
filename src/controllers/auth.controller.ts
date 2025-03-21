import { Request, Response, NextFunction, RequestHandler } from "express";
import * as authService from "@services/auth.service"
import { trimObject } from "@utils/sanitizers.util";

export const loginController: RequestHandler = async (req, res, next) => {
    try {
        const { email, phone_number, name, profile_pic, provider } = trimObject(req.body);

        console.log({ email, phone_number, name, profile_pic, provider })
        console.log(req.body)

        if ((!email && !phone_number) || !provider) {
             res.status(400).json({
                status: false,
                message: "Provider and either email or phone number are required for login!",
            });
            return
        }

        const response = await authService.loginService({
            email,
            phone_number,
            name,
            profile_pic,
            provider,
        });

         res.status(200).json(response);
         return
    } catch (err) {
        next(err);
    }
};
