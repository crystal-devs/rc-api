import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
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
    country_code: {
        type: String,
        default: "+91"
    }
}, {timestamps: true})

export default mongoose.model("User", userSchema, "users");
