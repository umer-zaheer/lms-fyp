import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["mcq", "true_false", "short"],
    default: "mcq",
  },
  prompt: { type: String, required: true },
  options: [String],
  answerIndex: Number,
  answerText: String,
  explanation: String,
});

const quizSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
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
    questions: [questionSchema],
    passScore: { type: Number, default: 70 },
    timeLimitMinutes: { type: Number, default: 30 },
    /** Total marks for this quiz (e.g. 10) */
    totalMarks: { type: Number, default: 10, min: 1 },
    /** auto = MCQ score; ai = AI awards marks; manual = instructor grades */
    gradingMode: {
      type: String,
      enum: ["auto", "ai", "manual"],
      default: "auto",
    },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    sourceFile: String,
    sourceType: {
      type: String,
      enum: ["manual", "pdf_ai", "student_pdf", "text_ai"],
      default: "manual",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Quiz", quizSchema);
