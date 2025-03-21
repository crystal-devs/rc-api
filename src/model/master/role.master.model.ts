import mongoose, { model } from "mongoose";

const roleSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "Role title is required to register a role."]
    },
    description: {
        type: String, 
    },
    access_to_rc_cam: {
        type: Boolean,
        default: true,
    },
    acces_to_rc_dash: {
        type: Boolean,
        default: true,
    },
    access_to_rc_admin: {
        type: Boolean,
        default: false,
    }
})

export default model("Role", roleSchema, "roles_master");