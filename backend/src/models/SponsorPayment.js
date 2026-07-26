import mongoose from "mongoose";

/**
 * Stripe payments for PPC course sponsorship budgets.
 * Separate from course-sale Payment records for clean admin tracking.
 */
const sponsorPaymentSchema = new mongoose.Schema(
  {
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    /** Set after fulfill for top-ups, or after creating sponsorship on budget purchase */
    sponsorship: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CourseSponsorship",
      default: null,
    },
    type: {
      type: String,
      enum: ["ppc_budget", "ppc_topup"],
      required: true,
    },
    /** Amount charged via Stripe (USD) */
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    currency: {
      type: String,
      default: "usd",
    },
    /** CPC to apply when activating a new ppc_budget sponsorship */
    costPerClick: {
      type: Number,
      min: 0,
      default: 0,
    },
    stripeSessionId: String,
    stripePaymentIntentId: String,
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      index: true,
    },
    paidAt: { type: Date },
    year: { type: Number, index: true },
    month: { type: Number, min: 1, max: 12, index: true },
    day: { type: Number, min: 1, max: 31 },
  },
  { timestamps: true }
);

sponsorPaymentSchema.index({ status: 1, createdAt: -1 });
sponsorPaymentSchema.index({ instructor: 1, status: 1 });

export default mongoose.model("SponsorPayment", sponsorPaymentSchema);
