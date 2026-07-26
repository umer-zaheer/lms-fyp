import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    amountTotal: { type: Number, required: true },
    platformFee: { type: Number, required: true },
    instructorAmount: { type: Number, required: true },
    currency: { type: String, default: "usd" },
    couponCode: String,
    stripeSessionId: String,
    stripePaymentIntentId: String,
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    /** When the purchase completed (paid) */
    purchasedAt: { type: Date },
    year: { type: Number, index: true },
    month: { type: Number, min: 1, max: 12, index: true },
    day: { type: Number, min: 1, max: 31 },
  },
  { timestamps: true }
);

paymentSchema.index({ instructor: 1, year: 1, month: 1, status: 1 });

export default mongoose.model("Payment", paymentSchema);
