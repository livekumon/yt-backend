import mongoose from "mongoose";
import { VALID_PRODUCT_TYPES } from "../config/tokenPacks.js";

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    paypalOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    paypalPaymentId: { type: String, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD", required: true },
    status: {
      type: String,
      enum: ["created", "approved", "completed", "failed", "refunded"],
      default: "created",
      required: true,
      index: true,
    },
    productType: {
      type: String,
      enum: VALID_PRODUCT_TYPES,
      default: "go_live",
      required: true,
    },
    publishingCreditsGranted: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, default: "paypal" },
    payerEmail: { type: String },
    payerName: { type: String },
    paypalResponse: { type: mongoose.Schema.Types.Mixed },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

paymentSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const Payment = mongoose.model("Payment", paymentSchema);
