import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    planId: { type: String, required: true },
    planName: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    provider: {
        type: String,
        enum: ['stripe', 'razorpay', 'mock'],
        required: true
    },
    // The ID returned by the provider (e.g., pi_12345, pay_12345, mock_12345)
    providerTransactionId: { type: String, required: true },
    status: {
        type: String,
        enum: ['pending', 'succeeded', 'failed', 'refunded'],
        default: 'pending'
    },
    metadata: { type: mongoose.Schema.Types.Mixed },
    errorMessage: { type: String }
}, {
    timestamps: true
});

// Indexes
transactionSchema.index({ userId: 1 });
transactionSchema.index({ providerTransactionId: 1 });
transactionSchema.index({ createdAt: -1 });

export const Transaction = mongoose.model(MODEL_NAMES.TRANSACTION || 'Transaction', transactionSchema, MODEL_NAMES.TRANSACTION || 'transactions');

export type TransactionType = InferSchemaType<typeof transactionSchema>;
