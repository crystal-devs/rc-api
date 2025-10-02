// models/BulkDownload.ts
import mongoose, { InferSchemaType, Document, Model } from 'mongoose';
import { MODEL_NAMES } from './names';

// Define the schema type
const bulkDownloadSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },

    // Unique job identifier
    job_id: { type: String, unique: true, required: true, index: true },

    // Event relationship
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.EVENT, required: true, index: true },
    share_token: { type: String, required: true, index: true },

    // Requester info (supports concurrent requests from multiple users)
    requested_by_type: { type: String, enum: ['guest', 'user', 'host'], required: true },
    requested_by_id: { type: String, required: true }, // guest_id or user ObjectId
    requester_email: { type: String, default: null }, // For notifications
    requester_name: { type: String, default: null },

    // Request configuration
    quality: {
        type: String,
        enum: ['thumbnail', 'medium', 'large', 'original'],
        default: 'original',
        index: true
    },
    include_videos: { type: Boolean, default: true },
    include_images: { type: Boolean, default: true },
    file_format: { type: String, enum: ['zip'], default: 'zip' },

    // Processing status (indexed for efficient queries)
    status: {
        type: String,
        enum: [
            'queued',           // Job created, waiting to start
            'processing',       // Actively downloading/processing files
            'compressing',      // Creating ZIP file
            'uploading',        // Uploading to cloud storage
            'completed',        // Ready for download
            'failed',           // Processing failed
            'expired',          // Download link expired
            'cancelled'         // Manually cancelled
        ],
        default: 'queued',
        required: true,
        index: true
    },

    // Detailed processing info
    current_stage: {
        type: String,
        enum: [
            'initializing',     // Setting up job
            'fetching_media',   // Querying media from database
            'downloading_files', // Downloading actual files
            'creating_archive', // Creating ZIP
            'uploading_archive', // Uploading to storage
            'generating_link',  // Creating download URL
            'notifying_user',   // Sending notification
            'completed'         // All done
        ],
        default: 'initializing'
    },
    progress_percentage: { type: Number, default: 0, min: 0, max: 100 },

    // File statistics
    total_files_requested: { type: Number, default: 0 },
    total_files_processed: { type: Number, default: 0 },
    total_files_failed: { type: Number, default: 0 },

    // Size estimates and actuals
    estimated_size_mb: { type: Number, default: 0 },
    actual_size_mb: { type: Number, default: 0 },

    // Media type breakdown
    media_breakdown: {
        images: { count: { type: Number, default: 0 }, size_mb: { type: Number, default: 0 } },
        videos: { count: { type: Number, default: 0 }, size_mb: { type: Number, default: 0 } }
    },

    // Download delivery
    download_url: { type: String, default: null },
    download_url_expires_at: { type: Date, default: null },

    // Cloud storage info
    storage_provider: { type: String, enum: ['imagekit', 'aws_s3', 'google_drive'], default: 'imagekit' },
    storage_key: { type: String, default: null }, // File path in cloud storage
    storage_file_id: { type: String, default: null }, // Provider-specific file ID

    // Processing metadata
    processing_started_at: { type: Date, default: null },
    processing_completed_at: { type: Date, default: null },
    processing_duration_ms: { type: Number, default: 0 },

    // Queue and worker info
    queue_job_id: { type: String, default: null }, // BullMQ job ID
    worker_instance: { type: String, default: null }, // Which worker processed this
    retry_count: { type: Number, default: 0 },

    // Error handling
    error_message: { type: String, default: null },
    error_code: { type: String, default: null },
    error_details: { type: mongoose.Schema.Types.Mixed, default: null },

    // Rate limiting and spam prevention
    user_ip_address: { type: String, default: null },
    user_agent: { type: String, default: null },

    // Notification status
    notification_sent: { type: Boolean, default: false },
    notification_method: { type: String, enum: ['email', 'webhook', 'none'], default: 'none' },

    // Cleanup and expiry
    auto_delete_at: { type: Date, default: null }, // When to delete the file
    cleanup_completed: { type: Boolean, default: false },

    // Audit trail
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now },
    expires_at: { type: Date, default: null, index: true } // TTL index
});

// Define the base document type
type BulkDownloadSchemaType = InferSchemaType<typeof bulkDownloadSchema>;

// Define the allowed stage types
type CurrentStage = 'initializing' | 'fetching_media' | 'downloading_files' | 'creating_archive' | 'uploading_archive' | 'generating_link' | 'notifying_user' | 'completed';

// Define instance methods interface
interface BulkDownloadMethods {
    updateProgress(stage: CurrentStage, percentage: number, additionalData?: any): Promise<BulkDownloadDocument>;
    markAsCompleted(downloadUrl: string, storageInfo: any): Promise<BulkDownloadDocument>;
    markAsFailed(error: Error | string, errorCode?: string): Promise<BulkDownloadDocument>;
}

// Define static methods interface
interface BulkDownloadStatics {
    findActiveJobsForUser(requestedById: string, eventId?: string): mongoose.Query<BulkDownloadDocument[], BulkDownloadDocument>;
    findRecentDownloadsForEvent(eventId: string, limit?: number): mongoose.Query<BulkDownloadDocument[], BulkDownloadDocument>;
}

// Create the document type that includes both schema fields and methods
export interface BulkDownloadDocument extends Document<mongoose.Types.ObjectId>, BulkDownloadSchemaType, BulkDownloadMethods { }

// Create the model type that includes both document and static methods
export interface BulkDownloadModel extends Model<BulkDownloadDocument>, BulkDownloadStatics { }

// Compound indexes for efficient queries
bulkDownloadSchema.index({ event_id: 1, status: 1, created_at: -1 });
bulkDownloadSchema.index({ requested_by_id: 1, status: 1, created_at: -1 });
bulkDownloadSchema.index({ share_token: 1, status: 1 });
bulkDownloadSchema.index({ job_id: 1, status: 1 });
bulkDownloadSchema.index({ queue_job_id: 1 }, { sparse: true });

// TTL index for automatic cleanup of expired records
bulkDownloadSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0, sparse: true });

// Pre-save middleware
bulkDownloadSchema.pre('save', function (next) {
    this.updated_at = new Date();

    // Set expiry for completed jobs (auto-delete after 7 days)
    if (this.status === 'completed' && !this.expires_at) {
        this.expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

    next();
});

// Instance methods for job management
bulkDownloadSchema.methods.updateProgress = async function (this: BulkDownloadDocument, stage: CurrentStage, percentage: number, additionalData?: any): Promise<BulkDownloadDocument> {
    // Use findOneAndUpdate to prevent parallel save conflicts
    const updated = await BulkDownload.findOneAndUpdate(
        { _id: this._id },
        {
            $set: {
                current_stage: stage,
                progress_percentage: Math.max(0, Math.min(100, percentage)),
                updated_at: new Date(),
                ...(additionalData || {})
            }
        },
        {
            new: true,
            runValidators: true
        }
    );

    if (!updated) {
        throw new Error('Failed to update progress - document not found');
    }

    // Update the current instance with new values
    this.current_stage = updated.current_stage;
    this.progress_percentage = updated.progress_percentage;
    this.updated_at = updated.updated_at;

    if (additionalData) {
        Object.assign(this, additionalData);
    }

    return this;
};
bulkDownloadSchema.methods.markAsCompleted = async function (this: BulkDownloadDocument, downloadUrl: string, storageInfo: any): Promise<BulkDownloadDocument> {
    this.status = 'completed';
    this.current_stage = 'completed';
    this.progress_percentage = 100;
    this.download_url = downloadUrl;
    this.processing_completed_at = new Date();

    if (this.processing_started_at) {
        this.processing_duration_ms = this.processing_completed_at.getTime() - this.processing_started_at.getTime();
    }

    // Set download URL expiry (24 hours)
    this.download_url_expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Storage info
    if (storageInfo) {
        this.storage_key = storageInfo.key;
        this.storage_file_id = storageInfo.fileId;
        this.actual_size_mb = storageInfo.sizeMb;
    }

    await this.save();
    return this;
};

bulkDownloadSchema.methods.markAsFailed = async function (this: BulkDownloadDocument, error: Error | string, errorCode?: string): Promise<BulkDownloadDocument> {
    this.status = 'failed';
    this.error_message = typeof error === 'string' ? error : error.message;
    this.error_code = errorCode;
    this.retry_count += 1;

    if (typeof error === 'object' && error.stack) {
        this.error_details = { stack: error.stack };
    }

    await this.save();
    return this;
};

// Static methods for job queries
bulkDownloadSchema.statics.findActiveJobsForUser = function (this: BulkDownloadModel, requestedById: string, eventId?: string) {
    const query: any = {
        requested_by_id: requestedById,
        status: { $in: ['queued', 'processing', 'compressing', 'uploading'] }
    };

    if (eventId) {
        query.event_id = eventId;
    }

    return this.find(query).sort({ created_at: -1 });
};

bulkDownloadSchema.statics.findRecentDownloadsForEvent = function (this: BulkDownloadModel, eventId: string, limit: number = 10) {
    return this.find({
        event_id: eventId,
        status: 'completed',
        download_url_expires_at: { $gt: new Date() }
    })
        .sort({ created_at: -1 })
        .limit(limit);
};

export const BulkDownload = mongoose.model<BulkDownloadDocument, BulkDownloadModel>('BulkDownload', bulkDownloadSchema);

// Also export the schema type for convenience
export type BulkDownloadType = BulkDownloadSchemaType;