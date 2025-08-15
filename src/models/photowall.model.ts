// models/photowall.model.ts (note: lowercase 'w' to match your import)
import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

const photoWallSchema = new mongoose.Schema({
  _id: { 
    type: String, 
    required: true,
    validate: {
      validator: function(v: string) {
        return /^wall_evt_[a-zA-Z0-9]{6,}$/.test(v);
      },
      message: 'PhotoWall ID must start with "wall_evt_" followed by share token'
    }
  },
  
  // Relationships
  eventId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: MODEL_NAMES.EVENT,
    required: true, 
    index: true 
  },
  shareToken: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  
  // Simple settings - only what matters for real-world usage
  settings: {
    // Basic controls
    isEnabled: { type: Boolean, default: true },
    
    // Display options
    displayMode: { 
      type: String, 
      enum: ['slideshow', 'grid', 'mosaic'], 
      default: 'slideshow' 
    },
    
    // Timing (2-30 seconds)
    transitionDuration: { 
      type: Number, 
      default: 5000, 
      min: 2000, 
      max: 30000 
    },
    
    // Privacy & Display
    showUploaderNames: { type: Boolean, default: false },
    
    // Playback
    autoAdvance: { type: Boolean, default: true },
    
    // 🎯 KEY FEATURE: Smart insertion strategy
    newImageInsertion: {
      type: String,
      enum: ['immediate', 'after_current', 'end_of_queue', 'smart_priority'],
      default: 'after_current'
    }
  },

  // Simple stats
  stats: {
    activeViewers: { type: Number, default: 0 },
    totalViews: { type: Number, default: 0 },
    lastViewedAt: { type: Date, default: null }
  },

  // Status
  isActive: { type: Boolean, default: true, index: true },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Essential indexes only
photoWallSchema.index({ shareToken: 1, isActive: 1 });
photoWallSchema.index({ eventId: 1, isActive: 1 });

// Pre-save middleware
photoWallSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance methods for common operations
photoWallSchema.methods.incrementViewers = function() {
  this.stats.activeViewers = (this.stats.activeViewers || 0) + 1;
  this.stats.totalViews = (this.stats.totalViews || 0) + 1;
  this.stats.lastViewedAt = new Date();
  return this.save();
};

photoWallSchema.methods.decrementViewers = function() {
  this.stats.activeViewers = Math.max(0, (this.stats.activeViewers || 0) - 1);
  return this.save();
};

photoWallSchema.methods.updateSettings = function(newSettings: any) {
  const allowedSettings = [
    'isEnabled', 
    'displayMode', 
    'transitionDuration', 
    'showUploaderNames', 
    'autoAdvance',
    'newImageInsertion'
  ];

  Object.keys(newSettings).forEach(key => {
    if (allowedSettings.includes(key)) {
      this.settings[key] = newSettings[key];
    }
  });

  this.updatedAt = new Date();
  return this.save();
};

// Static methods
photoWallSchema.statics.findByShareToken = function(shareToken: string) {
  return this.findOne({ shareToken, isActive: true });
};

photoWallSchema.statics.findByEventId = function(eventId: string) {
  return this.find({ eventId, isActive: true });
};

photoWallSchema.statics.createForEvent = async function(eventId: string, shareToken: string, customSettings?: any) {
  const defaultSettings = {
    isEnabled: true,
    displayMode: 'slideshow',
    transitionDuration: 5000,
    showUploaderNames: false,
    autoAdvance: true,
    newImageInsertion: 'after_current'
  };

  return this.create({
    _id: `wall_${shareToken}`,
    eventId,
    shareToken,
    settings: { ...defaultSettings, ...customSettings }
  });
};

interface PhotoWallModel extends mongoose.Model<PhotoWallType> {
  findByShareToken(shareToken: string): Promise<PhotoWallType>;
  findByEventId(eventId: string): Promise<PhotoWallType[]>;
  createForEvent(eventId: string, shareToken: string, customSettings?: any): Promise<PhotoWallType>;
}

export const PhotoWall = mongoose.model<PhotoWallType, PhotoWallModel>('PhotoWall', photoWallSchema, 'photowalls');

export type PhotoWallType = InferSchemaType<typeof photoWallSchema> & {
  incrementViewers(): Promise<any>;
  decrementViewers(): Promise<any>;
  updateSettings(newSettings: any): Promise<any>;
};