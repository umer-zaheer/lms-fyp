import mongoose from "mongoose";

const assignmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    instructions: { type: String, default: "" },
    /** Optional prompt / material text used for AI grading context */
    sourceText: { type: String, default: "" },
    totalMarks: { type: Number, default: 10, min: 1 },
    gradingMode: {
      type: String,
      enum: ["ai", "manual"],
      default: "manual",
    },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Assignment", assignmentSchema);
