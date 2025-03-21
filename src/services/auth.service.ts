import { keys } from "@configs/dotenv.config";
import jwt from "jsonwebtoken";
import userModel from "model/user.model";
import mongoose from "mongoose";

interface LoginData {
    email?: string;
    phone_number?: string;
    provider: string;
    name?: string;
    profile_pic?: string;
}

export const loginService = async ({ email, phone_number, name, profile_pic, provider }: LoginData) => {
    try {
        let user = await userModel.findOne({
            $or: [{ email }, { phone_number }],
        }).lean(); // Returns a plain object, no need for `.toObject()`

        if (!user) {
            // **Signup Flow**: If user does not exist, create a new one

            const newUser = await userModel.create({
                email,
                phone_number,
                role_id: new mongoose.Types.ObjectId("67dd8031cd6d859e3813e8bb"),
                provider,
                name: name || "Clicky", // Default name if not provided
                profile_pic: profile_pic || "",
            });

            user = newUser.toObject(); // Convert Mongoose document to plain object only for new users
        } 
        // Generate JWT Token
        const token = jwt.sign({userId: user._id}, keys.jwtSecret as string, {
            expiresIn: "1200h",
        });

        return {
            token,
            message: user?.createdAt ? "Login successful" : "Signup successful",
            status: true,
        };
    } catch (error) {
       throw(error)
    }
};
