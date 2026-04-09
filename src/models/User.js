import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, default: "" },
    passwordHash: { type: String },
    /** Credits usable for premium downloads (same field name as placetowebsite). */
    publishingCredits: { type: Number, default: 0 },
    creditsRemaining: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
