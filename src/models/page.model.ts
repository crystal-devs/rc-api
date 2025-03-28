import mongoose from "mongoose";
import albumModel from "./album.model";
import userModel from "./user.model";
const pageSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: "" },
    album_id: { type: mongoose.Schema.Types.ObjectId, ref: albumModel, required: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: userModel, required: true },
    created_at: { type: Date, default: Date.now },
});

export default mongoose.model("Page", pageSchema, "pages"); 