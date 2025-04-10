import { User } from "@models/user.model";

export const getUserByIdService = async (user_id: string) => {
    const user = await User.findById(user_id);
    if(!user) {
        throw new Error("User not found");
    }
    return user;    
}