import express from "express";
import { uploadMediaToImageKitController } from "@controllers/media.controller";
import { upload } from "@middlewares/multer.middleware";

const mediaRouter = express.Router();

// Single file upload: field name = "file"
mediaRouter.post("/upload", upload.single("file"), uploadMediaToImageKitController);

export default mediaRouter;
