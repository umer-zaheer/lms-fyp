import asyncHandler from "express-async-handler";
import { PDFParse } from "pdf-parse";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import {
  generateQuizFromText,
  gradeWithAi,
} from "../utils/openrouter.js";
import { throwHttp } from "../utils/helpers.js";
import {
  getWindowStatus,
  parseDateOrNull,
} from "../utils/assessmentWindow.js";

function attachAvailability(quizDoc) {
  const obj = quizDoc.toObject ? quizDoc.toObject() : { ...quizDoc };
  obj.availability = getWindowStatus(obj.startAt, obj.endAt);
  return obj;
}

export const listQuizzes = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.course) filter.course = req.query.course;

  if (req.user.role === "instructor") {
    filter.createdBy = req.user._id;
  } else if (req.user.role === "student") {
    filter.status = "published";
    if (!req.query.course) {
      const enrolled = await Enrollment.find({ student: req.user._id }).select(
        "course"
      );
      filter.course = { $in: enrolled.map((e) => e.course) };
    } else {
      const enrolled = await Enrollment.findOne({
        student: req.user._id,
        course: req.query.course,
      });
      if (!enrolled) throwHttp(res, 403, "Not enrolled in this course");
    }
  }

  const rows = await Quiz.find(filter)
    .populate("course", "title")
    .sort({ createdAt: -1 });

  const data = rows.map((q) => {
    const obj = attachAvailability(q);
    if (req.user.role === "student") {
      delete obj.questions;
    }
    return obj;
  });

  res.json({ success: true, data });
});

export const getQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id).populate(
    "course",
    "title instructor"
  );
  if (!quiz) throwHttp(res, 404, "Quiz not found");

  const isOwner = String(quiz.createdBy) === String(req.user._id);
  if (req.user.role === "student") {
    if (quiz.status !== "published") throwHttp(res, 404, "Quiz not found");
    const enrolled = await Enrollment.findOne({
      student: req.user._id,
      course: quiz.course._id || quiz.course,
    });
    if (!enrolled) throwHttp(res, 403, "Enroll in the course to take this quiz");
  } else if (!isOwner && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  const availability = getWindowStatus(quiz.startAt, quiz.endAt);
  const payload = quiz.toObject();
  payload.availability = availability;

  if (req.user.role === "student") {
    if (!availability.canOpen) {
      payload.questions = [];
      payload.locked = true;
      payload.lockMessage = availability.message;
    } else {
      payload.questions = payload.questions.map((q) => ({
        _id: q._id,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
      }));
      payload.locked = false;
    }
  }

  res.json({ success: true, data: payload, availability });
});

export const createQuiz = asyncHandler(async (req, res) => {
  const {
    title,
    courseId,
    questions,
    passScore,
    timeLimitMinutes,
    status,
    totalMarks,
    gradingMode,
    startAt,
    endAt,
  } = req.body;
  const course = await Course.findById(courseId);
  if (!course) throwHttp(res, 404, "Course not found");
  if (
    req.user.role === "instructor" &&
    String(course.instructor) !== String(req.user._id)
  ) {
    throwHttp(res, 403, "Not your course");
  }

  const quiz = await Quiz.create({
    title,
    course: courseId,
    createdBy: req.user._id,
    questions: questions || [],
    passScore: passScore ?? 70,
    timeLimitMinutes: timeLimitMinutes ?? 30,
    totalMarks: Number(totalMarks) > 0 ? Number(totalMarks) : 10,
    gradingMode: ["auto", "ai", "manual"].includes(gradingMode)
      ? gradingMode
      : "auto",
    startAt: parseDateOrNull(startAt),
    endAt: parseDateOrNull(endAt),
    status: status || "draft",
    sourceType: "manual",
  });

  res.status(201).json({ success: true, data: attachAvailability(quiz) });
});

export const updateQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throwHttp(res, 404, "Quiz not found");
  if (String(quiz.createdBy) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  [
    "title",
    "questions",
    "passScore",
    "timeLimitMinutes",
    "status",
    "totalMarks",
    "gradingMode",
  ].forEach((k) => {
    if (req.body[k] !== undefined) quiz[k] = req.body[k];
  });
  if (req.body.startAt !== undefined) quiz.startAt = parseDateOrNull(req.body.startAt);
  if (req.body.endAt !== undefined) quiz.endAt = parseDateOrNull(req.body.endAt);

  await quiz.save();
  res.json({ success: true, data: attachAvailability(quiz) });
});

export const deleteQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throwHttp(res, 404, "Quiz not found");
  if (String(quiz.createdBy) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }
  await quiz.deleteOne();
  res.json({ success: true, message: "Quiz deleted" });
});

/** PDF → OpenRouter quiz generation */
export const generateFromPdf = asyncHandler(async (req, res) => {
  if (!req.file) throwHttp(res, 400, "PDF file required");
  const {
    courseId,
    title,
    count,
    totalMarks,
    gradingMode,
    startAt,
    endAt,
    status,
  } = req.body;

  const course = await Course.findById(courseId);
  if (!course) throwHttp(res, 404, "Course not found");

  const isInstructor =
    req.user.role === "instructor" &&
    String(course.instructor) === String(req.user._id);
  const isAdmin = req.user.role === "admin";

  let isStudent = false;
  if (req.user.role === "student") {
    const enrolled = await Enrollment.findOne({
      student: req.user._id,
      course: courseId,
    });
    if (!enrolled) throwHttp(res, 403, "Enroll first to generate quizzes");
    isStudent = true;
  } else if (!isInstructor && !isAdmin) {
    throwHttp(res, 403, "Not allowed");
  }

  const parser = new PDFParse({ data: req.file.buffer });
  const textResult = await parser.getText();
  await parser.destroy();
  const text = textResult?.text?.trim();
  if (!text || text.length < 50) {
    throwHttp(res, 400, "Could not extract enough text from PDF");
  }

  const questions = await generateQuizFromText(text, {
    count: Math.min(Number(count) || 5, 8),
    title: title || `${course.title} Quiz`,
  });

  const quiz = await Quiz.create({
    title: title || `AI Quiz · ${course.title}`,
    course: courseId,
    createdBy: req.user._id,
    questions,
    totalMarks: Number(totalMarks) > 0 ? Number(totalMarks) : 10,
    gradingMode: ["auto", "ai", "manual"].includes(gradingMode)
      ? gradingMode
      : "auto",
    startAt: parseDateOrNull(startAt),
    endAt: parseDateOrNull(endAt),
    status: isStudent ? "published" : status === "published" ? "published" : "draft",
    sourceFile: req.file.originalname,
    sourceType: isStudent ? "student_pdf" : "pdf_ai",
  });

  res.status(201).json({ success: true, data: attachAvailability(quiz) });
});

/** Text → OpenRouter quiz generation (instructor picks count, pastes content) */
export const generateFromText = asyncHandler(async (req, res) => {
  const {
    courseId,
    title,
    count,
    text,
    totalMarks,
    gradingMode,
    startAt,
    endAt,
    status,
  } = req.body || {};

  if (!courseId) throwHttp(res, 400, "courseId is required");
  const content = String(text || "").trim();
  if (content.length < 40) {
    throwHttp(res, 400, "Paste more content (at least ~40 characters)");
  }

  const course = await Course.findById(courseId);
  if (!course) throwHttp(res, 404, "Course not found");
  if (
    req.user.role === "instructor" &&
    String(course.instructor) !== String(req.user._id)
  ) {
    throwHttp(res, 403, "Not your course");
  }
  if (req.user.role === "student") {
    throwHttp(res, 403, "Only instructors can generate quizzes from text");
  }

  const questions = await generateQuizFromText(content, {
    count: Math.min(Math.max(Number(count) || 5, 1), 8),
    title: title || `${course.title} Quiz`,
  });

  const quiz = await Quiz.create({
    title: title || `Text Quiz · ${course.title}`,
    course: courseId,
    createdBy: req.user._id,
    questions,
    totalMarks: Number(totalMarks) > 0 ? Number(totalMarks) : 10,
    gradingMode: ["auto", "ai", "manual"].includes(gradingMode)
      ? gradingMode
      : "auto",
    startAt: parseDateOrNull(startAt),
    endAt: parseDateOrNull(endAt),
    status: status === "published" ? "published" : "draft",
    sourceType: "text_ai",
  });

  res.status(201).json({ success: true, data: attachAvailability(quiz) });
});

export const submitAttempt = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz || quiz.status !== "published") throwHttp(res, 404, "Quiz not found");

  const enrolled = await Enrollment.findOne({
    student: req.user._id,
    course: quiz.course,
  });
  if (!enrolled && req.user.role === "student") {
    throwHttp(res, 403, "Not enrolled");
  }

  const availability = getWindowStatus(quiz.startAt, quiz.endAt);
  if (!availability.canOpen) {
    throwHttp(res, 403, availability.message);
  }

  const answers = req.body.answers || [];
  let correct = 0;
  const totalQ = quiz.questions.length;
  quiz.questions.forEach((q, i) => {
    const ans = answers.find(
      (a) => String(a.questionId) === String(q._id) || a.index === i
    );
    if (ans && ans.selectedIndex === q.answerIndex) correct += 1;
  });

  const percent = totalQ ? Math.round((correct / totalQ) * 100) : 0;
  const maxMarks = Number(quiz.totalMarks) > 0 ? Number(quiz.totalMarks) : 10;
  const mode = quiz.gradingMode || "auto";

  let marksAwarded = Math.round((correct / Math.max(totalQ, 1)) * maxMarks * 100) / 100;
  let status = "graded";
  let feedback = "";
  let gradedBy = "auto";
  let passed = percent >= (quiz.passScore || 70);

  if (mode === "manual") {
    status = "pending";
    marksAwarded = 0;
    gradedBy = "";
    passed = false;
    feedback = "Awaiting instructor grading";
  } else if (mode === "ai") {
    const answerSummary = answers
      .map((a, i) => {
        const q = quiz.questions.id?.(a.questionId) || quiz.questions[i];
        const selected =
          q?.options?.[a.selectedIndex] ??
          a.textAnswer ??
          `option ${a.selectedIndex}`;
        return `Q: ${q?.prompt || "?"}\nA: ${selected}`;
      })
      .join("\n\n");

    try {
      const ai = await gradeWithAi({
        title: quiz.title,
        instructions: `MCQ quiz. Student got ${correct}/${totalQ} correct (${percent}%). Award marks out of ${maxMarks} based on correctness and answer quality.`,
        contextText: quiz.questions
          .map((q, i) => `${i + 1}. ${q.prompt}`)
          .join("\n"),
        studentAnswer: answerSummary || "(no answers)",
        maxMarks,
      });
      marksAwarded = ai.marks;
      feedback = ai.feedback;
      gradedBy = "ai";
      status = "graded";
      passed = marksAwarded >= (maxMarks * (quiz.passScore || 70)) / 100;
    } catch {
      // fallback to auto marks
      gradedBy = "auto";
      feedback = "AI grading unavailable — scored automatically";
    }
  }

  const attempt = await QuizAttempt.create({
    quiz: quiz._id,
    student: req.user._id,
    answers,
    score: percent,
    marksAwarded,
    maxMarks,
    passed,
    status,
    feedback,
    gradedBy,
    completedAt: new Date(),
  });

  res.status(201).json({
    success: true,
    data: {
      attempt,
      score: percent,
      marksAwarded,
      maxMarks,
      passed,
      correct,
      total: totalQ,
      status,
      feedback,
      gradingMode: mode,
    },
  });
});

/** Instructor manually grades a quiz attempt */
export const gradeAttempt = asyncHandler(async (req, res) => {
  const attempt = await QuizAttempt.findById(req.params.attemptId).populate(
    "quiz"
  );
  if (!attempt) throwHttp(res, 404, "Attempt not found");
  const quiz = attempt.quiz;
  if (!quiz) throwHttp(res, 404, "Quiz not found");
  if (String(quiz.createdBy) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  const maxMarks = attempt.maxMarks || quiz.totalMarks || 10;
  let marks = Number(req.body.marksAwarded);
  if (!Number.isFinite(marks)) throwHttp(res, 400, "marksAwarded required");
  marks = Math.max(0, Math.min(maxMarks, marks));

  attempt.marksAwarded = marks;
  attempt.feedback = String(req.body.feedback || "");
  attempt.status = "graded";
  attempt.gradedBy = "instructor";
  attempt.passed = marks >= (maxMarks * (quiz.passScore || 70)) / 100;
  attempt.score = Math.round((marks / maxMarks) * 100);
  await attempt.save();

  res.json({ success: true, data: attempt });
});

export const listQuizAttempts = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throwHttp(res, 404, "Quiz not found");
  if (String(quiz.createdBy) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }
  const data = await QuizAttempt.find({ quiz: quiz._id })
    .populate("student", "name email")
    .sort({ createdAt: -1 });
  res.json({ success: true, data });
});
