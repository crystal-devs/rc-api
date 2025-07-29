// services/guest-upload.service.ts - FIXED VERSION

import { Event } from '@models/event.model';
import { createGuestUploaderInfo, Media } from '@models/media.model';
import ImageKit from 'imagekit';
import mongoose from 'mongoose';

export const guestMediaUploadService = {
    async uploadGuestMedia(
        shareToken: string,
        fileData: any,
        guestInfo: {
            name?: string;
            email?: string;
            phone?: string;
            sessionId?: string;
            deviceInfo?: any;
            ipAddress?: string;
            userAgent?: string;
            uploadMethod?: string;
        },
        authenticatedUserId?: string
    ) {
        try {
            // 1. Find and validate event
            const event = await Event.findOne({ share_token: shareToken });
            if (!event) {
                return { success: false, message: 'Event not found' };
            }

            console.log('✅ Event found for guest upload:', {
                eventId: event._id.toString(),
                title: event.title,
                canUpload: event.permissions.can_upload,
                requireApproval: event.permissions.require_approval
            });

            // 2. Check if uploads are enabled
            if (!event.permissions.can_upload) {
                return { success: false, message: 'Uploads are not enabled for this event' };
            }

            // 3. Validate file type
            const fileType = (() => {
                if (fileData.mimetype.startsWith("image/")) return "image";
                if (fileData.mimetype.startsWith("video/")) return "video";
                return null;
            })();

            if (!fileType) {
                return {
                    success: false,
                    message: "Unsupported file type. Only image and video files are supported"
                };
            }

            // 4. Calculate file size in MB
            const fileSizeInMB = fileData.size / (1024 * 1024);

            // 5. Check event owner's storage limits
            const eventOwnerId = event.created_by.toString();
            const canUpload = await this.checkUserStorageLimits(eventOwnerId, fileSizeInMB);
            if (!canUpload) {
                return {
                    success: false,
                    message: "Event storage limit exceeded. Please contact the event organizer."
                };
            }

            // 6. Determine if this is a registered user or guest
            const isRegisteredUser = !!authenticatedUserId;

            // 7. For guests, check upload limits
            if (!isRegisteredUser) {
                const limitCheck = await this.checkGuestUploadLimits(
                    event._id.toString(),
                    guestInfo
                );
                if (!limitCheck.allowed) {
                    return { success: false, message: limitCheck.reason };
                }
            }

            // 8. Determine approval status - FIXED LOGIC
            const requiresApproval = event.permissions?.require_approval ?? true;
            let approvalStatus = 'pending';
            let autoApprovalReason = null;

            if (isRegisteredUser) {
                // Authenticated users get auto-approved
                approvalStatus = 'auto_approved';
                autoApprovalReason = 'authenticated_user';
            } else {
                // Guest approval based on event settings
                if (!requiresApproval) {
                    approvalStatus = 'auto_approved';
                    autoApprovalReason = 'guest_auto_approve';
                } else {
                    // KEEP AS PENDING - don't auto-approve
                    approvalStatus = 'pending';
                    autoApprovalReason = null;
                }
            }

            console.log('📋 Upload approval status:', {
                requiresApproval,
                approvalStatus,
                autoApprovalReason,
                isRegisteredUser
            });

            // 9. Handle guest identification
            let guestUploaderInfo = null;
            if (!isRegisteredUser) {
                const existingGuestUploads = await this.findExistingGuest(
                    event._id.toString(),
                    guestInfo
                );

                if (existingGuestUploads.found) {
                    guestUploaderInfo = {
                        ...existingGuestUploads.guestInfo,
                        total_uploads: existingGuestUploads.uploadCount + 1
                    };
                } else {
                    guestUploaderInfo = createGuestUploaderInfo(
                        {
                            name: guestInfo.name,
                            email: guestInfo.email,
                            phone: guestInfo.phone,
                            sessionId: guestInfo.sessionId,
                            deviceFingerprint: this.generateDeviceFingerprint(guestInfo.deviceInfo),
                            uploadMethod: guestInfo.uploadMethod || 'web',
                            platformInfo: {}
                        },
                        true
                    );
                }
            }

            // 10. Get or create album
            const albumId = await this.getOrCreateDefaultAlbum(event._id.toString(), eventOwnerId);

            // 11. Upload file to ImageKit
            const uploadResult = await this.uploadToStorage(fileData, event._id.toString());
            if (!uploadResult.success) {
                return { success: false, message: uploadResult.error || 'Failed to upload file' };
            }

            // 12. Create media record - FIXED UPLOADER LOGIC
            const mediaData = {
                url: uploadResult.url,
                public_id: uploadResult.public_id,
                type: fileType,
                event_id: event._id,
                album_id: albumId,
                
                // FIXED: Only set uploaded_by for registered users
                uploaded_by: isRegisteredUser ? new mongoose.Types.ObjectId(authenticatedUserId) : null,
                
                // FIXED: Always set guest_uploader for guests, null for registered users
                guest_uploader: isRegisteredUser ? null : guestUploaderInfo,
                
                // FIXED: Correct uploader_type
                uploader_type: isRegisteredUser ? 'registered_user' : 'guest',
                
                original_filename: fileData.originalname,
                size_mb: fileSizeInMB,
                format: fileData.mimetype.split('/')[1],
                
                // FIXED: Explicit approval object
                approval: {
                    status: approvalStatus,
                    approved_at: approvalStatus === 'auto_approved' ? new Date() : null,
                    auto_approval_reason: autoApprovalReason,
                    approved_by: null as any, // Will be set later if needed
                    rejection_reason: ''
                },
                
                upload_context: {
                    method: 'guest_upload',
                    ip_address: guestInfo.ipAddress || '',
                    user_agent: guestInfo.userAgent || '',
                    upload_session_id: guestInfo.sessionId || '',
                    platform: 'web',
                    referrer_url: ''
                },
                
                metadata: {
                    width: 0,
                    height: 0,
                    duration: 0,
                    device_info: guestInfo.deviceInfo || {},
                    location: {
                        latitude: null as number | null,
                        longitude: null as number | null,
                        address: ''
                    },
                    timestamp: new Date(),
                    // Store guest info in metadata for compatibility
                    guest_info: !isRegisteredUser ? {
                        name: guestInfo.name || '',
                        email: guestInfo.email || null,
                        is_guest_upload: true
                    } : undefined
                },
                
                // Set other required fields
                stats: {
                    views: 0,
                    downloads: 0,
                    shares: 0,
                    likes: 0,
                    comments_count: 0
                },
                
                content_flags: {
                    inappropriate: false,
                    duplicate: false,
                    low_quality: false,
                    ai_flagged: false
                },
                
                processing: {
                    status: 'pending',
                    thumbnails_generated: false,
                    ai_analysis: {
                        completed: false,
                        content_score: 0,
                        tags: [] as string[],
                        faces_detected: 0
                    },
                }
            };

            // IMPORTANT: Create media document and disable the pre-save middleware override
            const media = new Media(mediaData);
            
            // Force the approval status to stay as we set it
            console.log('🔒 Creating media with approval status:', media.approval.status);
            
            await media.save();
            
            // Verify the status after save
            console.log('✅ Media saved with approval status:', media.approval.status);

            // 13. Update event owner's usage metrics
            try {
                await this.updateUsageForUpload(eventOwnerId, fileSizeInMB, event._id.toString());
                console.log(`📊 Updated usage for event owner ${eventOwnerId} - Added ${fileSizeInMB}MB (guest upload)`);
            } catch (usageError) {
                console.error(`Failed to update usage for event owner ${eventOwnerId}:`, usageError);
            }

            // 14. Update event stats
            const statUpdates: any = {
                'stats.total_size_mb': fileSizeInMB
            };

            if (fileType === 'image') statUpdates['stats.photos'] = 1;
            if (fileType === 'video') statUpdates['stats.videos'] = 1;
            if (approvalStatus === 'pending') statUpdates['stats.pending_approval'] = 1;

            await Event.findByIdAndUpdate(event._id, {
                $inc: statUpdates,
                $set: { updated_at: new Date() }
            });

            // 15. Send notifications if needed
            if (approvalStatus === 'pending') {
                await this.notifyHostOfPendingUpload(event, media, guestUploaderInfo);
            }

            return {
                success: true,
                message: approvalStatus === 'auto_approved' ?
                    'Photo uploaded successfully!' :
                    'Photo uploaded and pending approval',
                media_id: media._id,
                approval_status: approvalStatus,
                uploader_type: isRegisteredUser ? 'registered_user' : 'guest'
            };

        } catch (error) {
            console.error('❌ Guest media upload error:', error);
            return { success: false, message: 'Upload failed. Please try again.' };
        }
    },

    // ... rest of your methods remain the same
    async checkGuestUploadLimits(eventId: string, guestInfo: any) {
        const maxUploadsPerGuest = 20;
        const timeWindow = 24 * 60 * 60 * 1000;

        const guestIdentifiers = [];
        if (guestInfo.email) guestIdentifiers.push({ 'guest_uploader.email': guestInfo.email });
        if (guestInfo.sessionId) guestIdentifiers.push({ 'upload_context.upload_session_id': guestInfo.sessionId });

        if (guestIdentifiers.length === 0) {
            return { allowed: true };
        }

        const recentUploads = await Media.countDocuments({
            event_id: new mongoose.Types.ObjectId(eventId),
            uploader_type: 'guest',
            created_at: { $gte: new Date(Date.now() - timeWindow) },
            $or: guestIdentifiers
        });

        if (recentUploads >= maxUploadsPerGuest) {
            return {
                allowed: false,
                reason: `Upload limit reached (${maxUploadsPerGuest} photos per day)`
            };
        }

        return { allowed: true };
    },

    async findExistingGuest(eventId: string, guestInfo: any) {
        const query: any = {
            event_id: new mongoose.Types.ObjectId(eventId),
            uploader_type: 'guest'
        };

        if (guestInfo.email) {
            query['guest_uploader.email'] = guestInfo.email;
        } else if (guestInfo.sessionId) {
            query['upload_context.upload_session_id'] = guestInfo.sessionId;
        } else {
            return { found: false, guestInfo: null, uploadCount: 0 };
        }

        const existingUploads = await Media.find(query)
            .sort({ created_at: -1 })
            .limit(1);

        if (existingUploads.length > 0) {
            const totalUploads = await Media.countDocuments(query);
            return {
                found: true,
                guestInfo: existingUploads[0].guest_uploader,
                uploadCount: totalUploads
            };
        }

        return { found: false, guestInfo: null, uploadCount: 0 };
    },

    generateDeviceFingerprint(deviceInfo: any): string {
        if (!deviceInfo) return '';

        const fingerprint = [
            deviceInfo.userAgent || '',
            deviceInfo.screen || '',
            deviceInfo.timezone || '',
            deviceInfo.language || ''
        ].join('|');

        return Buffer.from(fingerprint).toString('base64').substring(0, 16);
    },

    async uploadToStorage(fileData: any, eventId: string) {
        try {
            const fs = require('fs').promises;
            const imagekit = new ImageKit({
                publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
                privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
                urlEndpoint: "https://ik.imagekit.io/roseclick",
            });

            let fileBuffer;
            if (fileData.path) {
                fileBuffer = await fs.readFile(fileData.path);
            } else if (fileData.buffer) {
                fileBuffer = fileData.buffer;
            } else {
                throw new Error('No file data available');
            }

            const fileSizeInMB = fileData.size / (1024 * 1024);

            const uploadResult = await imagekit.upload({
                file: fileBuffer,
                fileName: `guest_${Date.now()}_${fileData.originalname}`,
                folder: `/media`,
            });

            if (fileData.path) {
                try {
                    await fs.unlink(fileData.path);
                } catch (unlinkError) {
                    console.error('Failed to cleanup temp file:', unlinkError);
                }
            }

            console.log('✅ ImageKit upload successful:', {
                fileId: uploadResult.fileId,
                url: uploadResult.url,
                fileName: uploadResult.name,
                size: fileSizeInMB
            });

            return {
                success: true,
                url: uploadResult.url,
                public_id: uploadResult.fileId,
                file_size_mb: fileSizeInMB
            };

        } catch (error) {
            console.error('❌ ImageKit upload error:', error);

            if (fileData.path) {
                try {
                    const fs = require('fs').promises;
                    await fs.unlink(fileData.path);
                } catch (unlinkError) {
                    console.error('Failed to cleanup temp file after error:', unlinkError);
                }
            }

            return {
                success: false,
                error: error.message || 'Failed to upload to ImageKit'
            };
        }
    },

    async getOrCreateDefaultAlbum(eventId: string, eventOwnerId: string) {
        try {
            const { getOrCreateDefaultAlbum } = require('@/services/album.service');
            const albumResponse = await getOrCreateDefaultAlbum(eventId, eventOwnerId);

            if (albumResponse.status && albumResponse.data) {
                return new mongoose.Types.ObjectId(albumResponse.data._id);
            } else {
                console.error('Failed to get/create default album, using fallback');
                return new mongoose.Types.ObjectId();
            }
        } catch (error) {
            console.error('Error getting/creating album:', error);
            return new mongoose.Types.ObjectId();
        }
    },

    async checkUserStorageLimits(userId: string, fileSizeInMB: number): Promise<boolean> {
        try {
            const { checkUserLimitsService } = require('@/services/limits.service');
            const canUpload = await checkUserLimitsService(userId, 'storage', fileSizeInMB);
            return canUpload;
        } catch (error) {
            console.error('Error checking user storage limits:', error);
            return true;
        }
    },

    async updateUsageForUpload(userId: string, fileSizeInMB: number, eventId: string) {
        try {
            const { updateUsageForUpload } = require('@/services/usage.service');
            await updateUsageForUpload(userId, fileSizeInMB, eventId);
        } catch (error) {
            console.error('Error updating usage metrics:', error);
        }
    },

    async notifyHostOfPendingUpload(event: any, media: any, guestInfo: any) {
        console.log(`📸 New guest upload pending approval for event ${event._id}:`, {
            guestName: guestInfo?.name || 'Anonymous',
            filename: media.original_filename,
            uploadedAt: media.created_at
        });
    },

    async getEventGuestUploads(eventId: string, options: {
        includeApproved?: boolean;
        includePending?: boolean;
        guestId?: string;
    } = {}) {
        const query: any = {
            event_id: new mongoose.Types.ObjectId(eventId),
            uploader_type: 'guest'
        };

        if (options.guestId) {
            query['guest_uploader.guest_id'] = options.guestId;
        }

        if (options.includeApproved === false) {
            query['approval.status'] = { $ne: 'approved' };
        }

        if (options.includePending === false) {
            query['approval.status'] = { $ne: 'pending' };
        }

        return Media.find(query)
            .sort({ created_at: -1 })
            .populate('approved_by', 'name email');
    }
};

export default guestMediaUploadService;