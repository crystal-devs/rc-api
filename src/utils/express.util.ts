// utils/express.util.ts - Fixed sendResponse utility

import { Response } from 'express';

export interface ApiResponse {
    status: boolean;
    message: string;
    data: any;
}

export const sendResponse = (res: Response, responseData: any): void => {
    try {
        // Validate response data structure
        if (!responseData || typeof responseData !== 'object') {
            console.error('sendResponse: Invalid response data structure', responseData);
            res.status(500).json({
                status: false,
                message: 'Internal server error - invalid response structure',
                data: null
            });
            return;
        }

        // Ensure response has required fields
        const response: ApiResponse = {
            status: responseData.status ?? false,
            message: responseData.message || 'Unknown response',
            data: responseData.data || null
        };

        // Determine HTTP status code based on response status
        let httpStatusCode: number;
        
        if (response.status === true) {
            // Success responses
            if (responseData.created) {
                httpStatusCode = 201; // Created
            } else {
                httpStatusCode = 200; // OK
            }
        } else {
            // Error responses
            if (response.message?.toLowerCase().includes('not found')) {
                httpStatusCode = 404; // Not Found
            } else if (response.message?.toLowerCase().includes('permission') || 
                      response.message?.toLowerCase().includes('unauthorized')) {
                httpStatusCode = 403; // Forbidden
            } else if (response.message?.toLowerCase().includes('authentication') ||
                      response.message?.toLowerCase().includes('token')) {
                httpStatusCode = 401; // Unauthorized
            } else if (response.message?.toLowerCase().includes('validation') ||
                      response.message?.toLowerCase().includes('required') ||
                      response.message?.toLowerCase().includes('invalid')) {
                httpStatusCode = 400; // Bad Request
            } else {
                httpStatusCode = 500; // Internal Server Error
            }
        }

        // Add any additional fields from the original response
        const finalResponse = {
            ...response,
            ...(responseData.visibility_transition && { visibility_transition: responseData.visibility_transition }),
            ...(responseData.timestamp && { timestamp: responseData.timestamp })
        };

        console.log(`📤 Sending response: ${httpStatusCode} - ${response.status ? 'SUCCESS' : 'ERROR'} - ${response.message}`);
        
        res.status(httpStatusCode).json(finalResponse);
    } catch (error) {
        console.error('Error in sendResponse utility:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error in response handling',
            data: null
        });
    }
};

// Alternative: Simple sendResponse for cases where you want explicit control
export const sendSuccessResponse = (res: Response, data: any, message: string = 'Success', statusCode: number = 200): void => {
    res.status(statusCode).json({
        status: true,
        message,
        data
    });
};

export const sendErrorResponse = (res: Response, message: string, statusCode: number = 400, data: any = null): void => {
    res.status(statusCode).json({
        status: false,
        message,
        data
    });
};

// Wrapper for consistent error handling in controllers
export const handleControllerError = (res: Response, error: any, operation: string = 'operation'): void => {
    console.error(`Error in ${operation}:`, error);
    
    let statusCode = 500;
    let message = 'Internal server error';
    
    if (error.message) {
        message = error.message;
        
        // Map common error messages to appropriate status codes
        if (error.message.includes('required') || error.message.includes('invalid')) {
            statusCode = 400;
        } else if (error.message.includes('permission') || error.message.includes('unauthorized')) {
            statusCode = 403;
        } else if (error.message.includes('not found')) {
            statusCode = 404;
        } else if (error.message.includes('authentication')) {
            statusCode = 401;
        }
    }
    
    sendErrorResponse(res, message, statusCode);
};