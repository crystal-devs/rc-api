import mongoose from "mongoose";
import albumModel from "./album.model";
import pageModel from "./page.model";
import userModel from "./user.model";

const accessSchema = new mongoose.Schema({
    album_id: { type: mongoose.Schema.Types.ObjectId, ref: albumModel },
    page_id: { type: mongoose.Schema.Types.ObjectId, ref: pageModel },
    users: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: userModel,
        required: true,
        default: []
    },
    role: {
        type: String,
        enum: ["viewer", "editor", "owner"],
        required: true,
        default: "viewer"
    }
});

export default mongoose.model("Access", accessSchema, "access");