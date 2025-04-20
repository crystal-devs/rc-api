import { keys } from "@configs/dotenv.config";
import { User } from "@models/user.model";
import jwt from "jsonwebtoken";
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
        const query: any = {};
        if (email) query.email = email;
        if (phone_number) query.phone_number = phone_number;
        
        let user = await User.findOne(query).lean();        

        console.log(user, "is the user")

        if (!user) {
            // **Signup Flow**: If user does not exist, create a new one

            const newUser = await User.create({
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
        const token = jwt.sign({user_id: user._id}, keys.jwtSecret as string, {
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
