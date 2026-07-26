import mongoose from "mongoose";

/**
 * One row per course purchase — used for seller earnings charts.
 * Tracks which student bought which course and on which day/month/year.
 */
const earningSchema = new mongoose.Schema(
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
      index: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },
    enrollment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Enrollment",
    },
    /** Gross course sale amount */
    amountTotal: { type: Number, required: true, default: 0 },
    /** Instructor share (what shows on earnings graph) */
    amount: { type: Number, required: true, default: 0 },
    currency: { type: String, default: "usd" },
    purchasedAt: { type: Date, required: true, index: true },
    year: { type: Number, required: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12, index: true },
    day: { type: Number, required: true, min: 1, max: 31 },
  },
  { timestamps: true }
);

earningSchema.index({ instructor: 1, year: 1, month: 1 });
earningSchema.index(
  { student: 1, course: 1 },
  { unique: true }
);

export default mongoose.model("Earning", earningSchema);
