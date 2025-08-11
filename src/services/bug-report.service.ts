import { BugReport, TBugReport } from "@models/bug-report.model";
import { ServiceResponse } from "types/service.types";

export const addBugReportService = async (params: Partial<TBugReport>) : Promise<ServiceResponse<TBugReport>> => {
    try{

        if(!params || typeof params !== "object" || !params.title || !params.description || !params.user_id){
            return {
                status: false,
                code: 400,
                message: "Invalid parameters",
                data: null,
                error: {
                    message: "Invalid parameters",
                },
                other: null,
            };
        }

        const { title, description, user_id, image_url, video_url } = params;

        if(!title || !description || !user_id){
            return {
                status: false,
                code: 400,
                message: "Invalid parameters",
                data: null,
                error: {
                    message: "Invalid parameters",
                },
                other: null,
            };
        }

        const bugReport = await BugReport.create({
            title,
            description,
            user_id,
            image_url,
            video_url,
        });
        return {
            status: true,
            code: 200,
            message: "Bug report added successfully",
            data: bugReport,
            error: null,
            other: null,
        };
    }catch(error: any){
        return {
            status: false,
            code: 500,
            message: "Failed to add bug report",
            data: null,
            error: {
                message: error.message,
            },
            other: null,
        };
    }
}