import mongoose from "mongoose";

const quizAttemptSchema = new mongoose.Schema(
  {
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    answers: [
      {
        questionId: String,
        selectedIndex: Number,
        textAnswer: String,
      },
    ],
    score: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    completedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model("QuizAttempt", quizAttemptSchema);
