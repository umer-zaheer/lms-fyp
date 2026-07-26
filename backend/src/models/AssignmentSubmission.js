import mongoose from "mongoose";

const assignmentSubmissionSchema = new mongoose.Schema(
  {
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assignment",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    textAnswer: { type: String, default: "" },
    marksAwarded: { type: Number, default: 0 },
    maxMarks: { type: Number, default: 10 },
    status: {
      type: String,
      enum: ["submitted", "graded", "pending"],
      default: "pending",
    },
    feedback: { type: String, default: "" },
    gradedBy: {
      type: String,
      enum: ["ai", "instructor", ""],
      default: "",
    },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

assignmentSubmissionSchema.index(
  { assignment: 1, student: 1 },
  { unique: true }
);

export default mongoose.model("AssignmentSubmission", assignmentSubmissionSchema);
