// 4. services/media/media-upload.service.ts
// ====================================

import ImageKit from 'imagekit';
import { logger } from '@utils/logger';
import type { ServiceResponse } from './media.types';

// ImageKit configuration
const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

export const uploadCoverImageService = async (
    file: Express.Multer.File,
    folder: string = 'covers'
): Promise<ServiceResponse<any>> => {
    try {
        const fs = await import('fs/promises');
        const fileBuffer = await fs.readFile(file.path);

        const uploadResult = await imagekit.upload({
            file: fileBuffer,
            fileName: `cover_${Date.now()}_${file.originalname}`,
            folder: `/${folder}`,
            transformation: {
                pre: 'q_auto,f_auto,w_1920,h_1080,c_limit'
            }
        });

        // Clean up temp file
        await fs.unlink(file.path).catch(() => { });

        logger.info('Cover image uploaded successfully', {
            filename: file.originalname,
            url: uploadResult.url,
            fileId: uploadResult.fileId
        });

        return {
            status: true,
            code: 200,
            message: 'Cover image uploaded successfully',
            data: {
                url: uploadResult.url,
                fileId: uploadResult.fileId,
                originalName: file.originalname,
                size: file.size
            },
            error: null,
            other: {
                folder,
                imagekit_response: uploadResult
            }
        };

    } catch (error: any) {
        logger.error('Cover image upload failed:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to upload cover image',
            data: null,
            error: { message: error.message }
        };
    }
};
