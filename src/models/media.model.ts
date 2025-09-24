    // models/Media.ts - Updated with Image Variants Support
    import mongoose, { InferSchemaType } from "mongoose";
    import { MODEL_NAMES } from "./names";

    // Image variant sub-schema
    const imageVariantSchema = new mongoose.Schema({
        url: { type: String, required: true },
        width: { type: Number, required: true },
        height: { type: Number, required: true },
        size_mb: { type: Number, required: true },
        format: { type: String, enum: ['webp', 'jpeg'], required: true }
    }, { _id: false });

    // Image variants schema
    const imageVariantsSchema = new mongoose.Schema({
        original: {
            url: { type: String, required: true },
            width: { type: Number, required: true },
            height: { type: Number, required: true },
            size_mb: { type: Number, required: true },
            format: { type: String, required: true }
        },
        small: {
            webp: { type: imageVariantSchema, required: true },
            jpeg: { type: imageVariantSchema, required: true }
        },
        medium: {
            webp: { type: imageVariantSchema, required: true },
            jpeg: { type: imageVariantSchema, required: true }
        },
        large: {
            webp: { type: imageVariantSchema, required: true },
            jpeg: { type: imageVariantSchema, required: true }
        }
    }, { _id: false });

    // Guest uploader info schema
    const guestUploaderSchema = new mongoose.Schema({
        guest_id: { type: String, required: true },
        name: { type: String, default: "" },
        email: { type: String, default: "" },
        phone: { type: String, default: "" },
        session_id: { type: String, default: "" },
        device_fingerprint: { type: String, default: "" },
        upload_method: { type: String, enum: ['web', 'mobile', 'qr_scan', 'direct_link'], default: 'web' },
        total_uploads: { type: Number, default: 1 },
        first_upload_at: { type: Date, default: Date.now },
        platform_info: {
            source: { type: String, default: "" },
            referrer: { type: String, default: "" }
        }
    }, { _id: false });

    // Enhanced metadata schema
    const metadataSchema = new mongoose.Schema({
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
        duration: { type: Number, default: 0 },
        aspect_ratio: { type: Number, default: 1 }, // height/width
        color_profile: { type: String, default: "" },
        has_transparency: { type: Boolean, default: false },
        device_info: {
            brand: { type: String, default: "" },
            model: { type: String, default: "" },
            os: { type: String, default: "" }
        },
        location: {
            latitude: { type: Number, default: null },
            longitude: { type: Number, default: null },
            address: { type: String, default: "" }
        },
        timestamp: { type: Date, default: null },
        camera_settings: {
            iso: { type: Number, default: null },
            aperture: { type: String, default: "" },
            shutter_speed: { type: String, default: "" },
            focal_length: { type: String, default: "" }
        }
    }, { _id: false });

    // Enhanced processing schema
    const processingSchema = new mongoose.Schema({
        status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
        started_at: { type: Date, default: null },
        completed_at: { type: Date, default: null },
        processing_time_ms: { type: Number, default: 0 },

        // Variant generation tracking
        variants_generated: { type: Boolean, default: false },
        variants_count: { type: Number, default: 0 },
        total_variants_size_mb: { type: Number, default: 0 },

        // Error handling
        error_message: { type: String, default: "" },
        retry_count: { type: Number, default: 0 },

        // AI analysis (future)
        ai_analysis: {
            completed: { type: Boolean, default: false },
            content_score: { type: Number, default: 0 },
            tags: [{ type: String }],
            faces_detected: { type: Number, default: 0 },
            inappropriate_content: { type: Boolean, default: false }
        }
    }, { _id: false });

    const approvalSchema = new mongoose.Schema({
        status: { type: String, enum: ['pending', 'approved', 'rejected', 'auto_approved', 'hidden'], default: 'pending' },
        approved_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },
        approved_at: { type: Date, default: null },
        rejection_reason: { type: String, default: "" },
        auto_approval_reason: {
            type: String,
            enum: ['authenticated_user', 'guest_auto_approve', 'ai_safe', 'host_setting'],
            default: null
        }
    }, { _id: false });

    // Main Media Schema
    const mediaSchema = new mongoose.Schema({
        _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },

        // Core media info
        url: { type: String, required: true }, // Legacy field - points to original
        public_id: { type: String, default: "" }, // ImageKit public ID
        type: { type: String, enum: ["image", "video"], required: true },

        // NEW: Image variants (only for images)
        image_variants: {
            type: imageVariantsSchema,
            default: null
        },

        // Relationships
        album_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.ALBUM, required: true },
        event_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.EVENT, required: true },

        // Uploader info
        uploaded_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: MODEL_NAMES.USER,
            required: false,
            default: null
        },
        guest_uploader: {
            type: guestUploaderSchema,
            default: null
        },
        uploader_type: {
            type: String,
            enum: ['registered_user', 'guest'],
            required: true,
            default: function () {
                return this.uploaded_by ? 'registered_user' : 'guest';
            }
        },

        // File info
        original_filename: { type: String, default: "" },
        size_mb: { type: Number, default: 0 }, // Original file size
        format: { type: String, default: "" }, // Original format

        // Processing and optimization
        processing: { type: processingSchema, default: () => ({}) },

        // Enhanced metadata
        metadata: { type: metadataSchema, default: () => ({}) },

        // Approval system
        approval: { type: approvalSchema, default: () => ({}) },

        // Legacy fields (backward compatibility)
        approval_status: { type: Boolean, default: true },
        approved_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },

        // Engagement metrics
        stats: {
            views: { type: Number, default: 0 },
            downloads: { type: Number, default: 0 },
            shares: { type: Number, default: 0 },
            likes: { type: Number, default: 0 },
            comments_count: { type: Number, default: 0 }
        },

        // Content safety
        content_flags: {
            inappropriate: { type: Boolean, default: false },
            duplicate: { type: Boolean, default: false },
            low_quality: { type: Boolean, default: false },
            ai_flagged: { type: Boolean, default: false }
        },

        // Upload context
        upload_context: {
            method: { type: String, enum: ['web', 'mobile', 'api', 'guest_upload'], default: 'web' },
            ip_address: { type: String, default: "" },
            user_agent: { type: String, default: "" },
            upload_session_id: { type: String, default: "" },
            referrer_url: { type: String, default: "" },
            platform: { type: String, default: "web" }
        },

        // Timestamps
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now }
    });

    // Indexes
    mediaSchema.index({ event_id: 1, album_id: 1 });
    mediaSchema.index({ uploaded_by: 1, created_at: -1 });
    mediaSchema.index({ "guest_uploader.guest_id": 1, event_id: 1 });
    mediaSchema.index({ "guest_uploader.email": 1, event_id: 1 });
    mediaSchema.index({ "approval.status": 1, event_id: 1 });
    mediaSchema.index({ "processing.status": 1 });
    mediaSchema.index({ type: 1, event_id: 1 });
    mediaSchema.index({ uploader_type: 1, event_id: 1 });
    mediaSchema.index({ "content_flags.inappropriate": 1 });
    mediaSchema.index({ created_at: -1 });

    // Pre-save middleware
    mediaSchema.pre('save', function (next) {
        if (this.isNew) {
            // Set uploader type
            if (this.uploaded_by && !this.guest_uploader) {
                this.uploader_type = 'registered_user';
            } else if (!this.uploaded_by && this.guest_uploader) {
                this.uploader_type = 'guest';
            }

            // Set default approval if not provided
            if (!this.approval || this.approval.status === undefined) {
                this.approval = {
                    status: 'pending',
                    approved_by: null,
                    approved_at: null,
                    rejection_reason: '',
                    auto_approval_reason: null
                };
            }

            // Calculate aspect ratio if metadata exists
            if (this.metadata?.width && this.metadata?.height) {
                this.metadata.aspect_ratio = this.metadata.height / this.metadata.width;
            }
        }

        this.updated_at = new Date();
        next();
    });

    // Virtual for uploader display name
    mediaSchema.virtual('uploader_display_name').get(function (this: any) {
        if (this.uploader_type === 'registered_user' && this.uploaded_by) {
            if (typeof this.uploaded_by === 'object' && 'name' in this.uploaded_by) {
                return this.uploaded_by.name;
            }
            return 'User';
        } else if (this.uploader_type === 'guest' && this.guest_uploader) {
            return this.guest_uploader.name || 'Anonymous Guest';
        }
        return 'Unknown';
    });

    // Virtual for best image URL based on context
    mediaSchema.virtual('best_url').get(function (this: any) {
        // For backward compatibility, return original URL if no variants
        if (!this.image_variants) {
            return this.url;
        }

        // Return medium JPEG as default best URL
        return this.image_variants?.medium?.jpeg?.url || this.url;
    });

    // Instance methods
    mediaSchema.methods.canContactUploader = function () {
        if (this.uploader_type === 'registered_user') {
            return true;
        } else if (this.uploader_type === 'guest' && this.guest_uploader) {
            return !!(this.guest_uploader.email || this.guest_uploader.phone);
        }
        return false;
    };

    // Get optimized URL for specific context
    mediaSchema.methods.getOptimizedUrl = function (
        context: 'mobile' | 'desktop' | 'lightbox' = 'desktop',
        supportsWebP: boolean = true
    ): string {
        if (!this.image_variants || this.type !== 'image') {
            return this.url; // Fallback to original
        }

        const variants = this.image_variants;
        let targetVariant;

        switch (context) {
            case 'mobile':
                targetVariant = variants.small;
                break;
            case 'desktop':
                targetVariant = variants.medium;
                break;
            case 'lightbox':
                targetVariant = variants.large;
                break;
            default:
                targetVariant = variants.medium;
        }

        if (supportsWebP && targetVariant?.webp?.url) {
            return targetVariant.webp.url;
        } else if (targetVariant?.jpeg?.url) {
            return targetVariant.jpeg.url;
        }

        // Fallback chain
        return variants.medium?.jpeg?.url || variants.small?.jpeg?.url || this.url;
    };

    // Check if image processing is complete
    mediaSchema.methods.isProcessingComplete = function (): boolean {
        return this.processing?.status === 'completed' && this.processing?.variants_generated === true;
    };

    export const Media = mongoose.model(MODEL_NAMES.MEDIA, mediaSchema, MODEL_NAMES.MEDIA);

    export type MediaType = InferSchemaType<typeof mediaSchema>;
    export type MediaCreationType = Omit<MediaType, '_id'>;

    // Helper functions remain the same
    export const generateGuestId = (guestInfo?: { name?: string; email?: string; device?: string }): string => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);

        if (guestInfo?.email) {
            const emailHash = guestInfo.email.toLowerCase().split('@')[0].substring(0, 4);
            return `guest_${emailHash}_${random}`;
        } else if (guestInfo?.name) {
            const nameHash = guestInfo.name.toLowerCase().replace(/\s+/g, '').substring(0, 4);
            return `guest_${nameHash}_${random}`;
        } else {
            return `guest_anon_${timestamp}_${random}`;
        }
    };

    export const createGuestUploaderInfo = (
        guestData: {
            name?: string;
            email?: string;
            phone?: string;
            sessionId?: string;
            deviceFingerprint?: string;
            uploadMethod?: string;
            platformInfo?: any;
        },
        isFirstUpload: boolean = true
    ) => {
        const guestId = generateGuestId({
            name: guestData.name,
            email: guestData.email,
            device: guestData.deviceFingerprint
        });

        return {
            guest_id: guestId,
            name: guestData.name || '',
            email: guestData.email || '',
            phone: guestData.phone || '',
            session_id: guestData.sessionId || '',
            device_fingerprint: guestData.deviceFingerprint || '',
            upload_method: guestData.uploadMethod || 'web',
            total_uploads: isFirstUpload ? 1 : undefined,
            first_upload_at: isFirstUpload ? new Date() : undefined,
            platform_info: guestData.platformInfo || {}
        };
    };