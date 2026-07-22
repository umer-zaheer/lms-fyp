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
  },
  { timestamps: true }
);

enrollmentSchema.index({ student: 1, course: 1 }, { unique: true });

export default mongoose.model("Enrollment", enrollmentSchema);
