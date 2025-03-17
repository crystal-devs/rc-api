import userModel from "model/user.model";
import jwt from "jsonwebtoken";
import { keys } from "@configs/dotenv.config";
import bcrypt from "bcryptjs";

interface LoginData {
    email?: string;
    phone_number?: string;
    password: string;
    name?: string;
    profile_pic?: string;
}

export const loginService = async ({ email, phone_number, password: plainPassword, name, profile_pic }: LoginData) => {
    try {
        let user = await userModel.findOne({
            $or: [{ email }, { phone_number }],
        }).lean(); // Returns a plain object, no need for `.toObject()`

        if (!user) {
            // **Signup Flow**: If user does not exist, create a new one
            const hashedPassword = await bcrypt.hash(plainPassword, 10); // Secure password hashing

            const newUser = await userModel.create({
                email,
                phone_number,
                password: hashedPassword, // Store hashed password
                name: name || "Clicky", // Default name if not provided
                profile_pic: profile_pic || "",
            });

            user = newUser.toObject(); // Convert Mongoose document to plain object only for new users
        } else {
            // **Login Flow**: Validate password
            const isPasswordValid = await bcrypt.compare(plainPassword, user.password!); // Use plainPassword instead of password
            if (!isPasswordValid) {
                return {
                    status: false,
                    message: "Invalid email/phone or password",
                };
            }
        }

        const { password, ...userWithoutPassword } = user; // Remove password field

        // Generate JWT Token
        const token = jwt.sign(userWithoutPassword, keys.jwtSecret as string, {
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
