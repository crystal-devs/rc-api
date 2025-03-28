import mongoose, { InferSchemaType } from "mongoose";

const userSchema = new mongoose.Schema({
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    role_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Role",
    },
    name: {
        type: String,
        default: "clicky",
    },
    profile_pic: {
        type: String,
    },
    password: {
        type: String,
    },
    email: {
        type: String,
    },
    phone_number: {
        type: String,
    },
    provider: {
        type: String,
        enum: ["google", "apple", "instagram", "facebook"]
    },
    country_code: {
        type: String,
        default: "+91"
    }
}, {timestamps: true})

export default mongoose.model("User", userSchema, "users");

// Infer the TypeScript type from the schema
export type UserType = InferSchemaType<typeof userSchema>;