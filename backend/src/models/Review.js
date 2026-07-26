import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 250,
    },
    helpfulCount: {
      type: Number,
      default: 0,
    },
    /** Users who marked this review helpful (one vote each) */
    helpfulBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    /** Instructor / seller reply to the student review */
    sellerResponse: {
      type: String,
      trim: true,
      maxlength: [250, "Seller response cannot exceed 250 characters"],
      default: "",
    },
    sellerRespondedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

reviewSchema.index({ course: 1, student: 1 }, { unique: true });

export default mongoose.model("Review", reviewSchema);
