import asyncHandler from "express-async-handler";
import { PDFParse } from "pdf-parse";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import { generateQuizFromText } from "../utils/openrouter.js";
import { throwHttp } from "../utils/helpers.js";

export const listQuizzes = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.course) filter.course = req.query.course;

  if (req.user.role === "instructor") {
    filter.createdBy = req.user._id;
  } else if (req.user.role === "student") {
    filter.status = "published";
    if (!req.query.course) {
      const enrolled = await Enrollment.find({ student: req.user._id }).select("course");
      filter.course = { $in: enrolled.map((e) => e.course) };
    }
  }

  const data = await Quiz.find(filter)
    .populate("course", "title")
    .sort({ createdAt: -1 });

  res.json({ success: true, data });
});

export const getQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id).populate("course", "title instructor");
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

  // Hide answers for students until submit
  const payload = quiz.toObject();
  if (req.user.role === "student") {
    payload.questions = payload.questions.map((q) => ({
      _id: q._id,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
    }));
  }

  res.json({ success: true, data: payload });
});

export const createQuiz = asyncHandler(async (req, res) => {
  const { title, courseId, questions, passScore, timeLimitMinutes, status } = req.body;
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
    status: status || "draft",
    sourceType: "manual",
  });

  res.status(201).json({ success: true, data: quiz });
});

export const updateQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throwHttp(res, 404, "Quiz not found");
  if (String(quiz.createdBy) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  ["title", "questions", "passScore", "timeLimitMinutes", "status"].forEach((k) => {
    if (req.body[k] !== undefined) quiz[k] = req.body[k];
  });
  await quiz.save();
  res.json({ success: true, data: quiz });
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

/** PDF → OpenRouter quiz generation (instructor or enrolled student) */
export const generateFromPdf = asyncHandler(async (req, res) => {
  if (!req.file) throwHttp(res, 400, "PDF file required");
  const { courseId, title, count } = req.body;
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
    status: isStudent ? "published" : "draft",
    sourceFile: req.file.originalname,
    sourceType: isStudent ? "student_pdf" : "pdf_ai",
  });

  res.status(201).json({ success: true, data: quiz });
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

  const answers = req.body.answers || [];
  let correct = 0;
  quiz.questions.forEach((q, i) => {
    const ans = answers.find(
      (a) => String(a.questionId) === String(q._id) || a.index === i
    );
    if (ans && ans.selectedIndex === q.answerIndex) correct += 1;
  });

  const score = quiz.questions.length
    ? Math.round((correct / quiz.questions.length) * 100)
    : 0;
  const passed = score >= (quiz.passScore || 70);

  const attempt = await QuizAttempt.create({
    quiz: quiz._id,
    student: req.user._id,
    answers,
    score,
    passed,
    completedAt: new Date(),
  });

  res.status(201).json({
    success: true,
    data: {
      attempt,
      score,
      passed,
      correct,
      total: quiz.questions.length,
    },
  });
});
