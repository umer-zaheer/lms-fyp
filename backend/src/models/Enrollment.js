import mongoose from "mongoose";

const enrollmentSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    completedLessons: [{ type: String }],
    pricePaid: { type: Number, default: 0 },
    couponCode: String,
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },
    completedAt: Date,
    /** When the student enrolled / bought the course */
    enrolledAt: { type: Date, default: Date.now, index: true },
    year: { type: Number, index: true },
    month: { type: Number, min: 1, max: 12, index: true },
    day: { type: Number, min: 1, max: 31 },
  },
  { timestamps: true }
);

enrollmentSchema.index({ student: 1, course: 1 }, { unique: true });
enrollmentSchema.index({ year: 1, month: 1 });

export default mongoose.model("Enrollment", enrollmentSchema);
