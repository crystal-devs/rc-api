import mongoose from "mongoose";
import albumModel from "./album.model";
import pageModel from "./page.model";
import userModel from "./user.model";

const mediaSchema = new mongoose.Schema({
    url: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], required: true },
    album_id: { type: mongoose.Schema.Types.ObjectId, ref: albumModel, required: true },
    page_id: { type: mongoose.Schema.Types.ObjectId, ref: pageModel },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: userModel, required: true },
    created_at: { type: Date, default: Date.now },
});

export default mongoose.model("Media", mediaSchema, "media");