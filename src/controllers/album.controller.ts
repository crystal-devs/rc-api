import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, Response } from "express"
import { injectedRequest } from "types/injected-types"
import * as albumService from "@services/album.service";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";

export const createAlbumController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { title, description, start_date, end_date, is_private = false } = trimObject(req.body);
        // validate the data
        if(!title || !start_date) throw new Error("missing required fields");
    
        if(end_date && start_date > end_date) throw new Error("Start date must be before end date");

        if(typeof title !== "string" || typeof description !== "string" || !(start_date instanceof Date) ||  (end_date &&!(end_date instanceof Date)) ) throw new Error("Invalid data type");
       
        const response = await albumService.createAlbumService({
            title,
            description,
            start_date,
            end_date,
            created_by: new mongoose.Types.ObjectId(req.user._id),
            is_private,
            created_at: new Date()
        });
        sendResponse(res, response);
    } catch (_err) {
        next(_err)
    }
}

export const getUserAlbumsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try{
        const user_id = req.user._id.toString(); // we will defenetly get the user id from the auth middleware
        const response = await albumService.getAlbumsByAlbumIdOrUserId({ user_id });
        sendResponse(res, response);
    }catch(_err){
        next(_err);
    }
}

export const getAlbumController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try{
        const { album_id } = trimObject(req.params);
        if(!album_id) throw new Error("Album id is required");
        const response = await albumService.getAlbumsByAlbumIdOrUserId({ album_id });
        sendResponse(res, response);
    }catch(_err){
        next(_err);
    }
}

export const updateAlbumController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try{
        const { title, description, start_date, end_date } = trimObject(req.body);
        const { album_id } = trimObject(req.params);
        // validate the data
        if(!title || !start_date || !end_date) throw new Error("missing required fields");
    
        if(start_date > end_date) throw new Error("Start date must be before end date");

        if(typeof title !== "string" || typeof description !== "string" || !(start_date instanceof Date) || !(end_date instanceof Date)) throw new Error("Invalid data type");

       
    }catch(_err){
        next(_err);
    }
}
