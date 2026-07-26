import asyncHandler from "express-async-handler";
import Assignment from "../models/Assignment.js";
import AssignmentSubmission from "../models/AssignmentSubmission.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import { gradeWithAi } from "../utils/openrouter.js";
import { throwHttp } from "../utils/helpers.js";
import {
  getWindowStatus,
  parseDateOrNull,
} from "../utils/assessmentWindow.js";

function attachAvailability(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.availability = getWindowStatus(obj.startAt, obj.endAt);
  return obj;
}

export const listAssignments = asyncHandler(async (req, res) => {
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

  const rows = await Assignment.find(filter)
    .populate("course", "title")
    .sort({ createdAt: -1 });

  res.json({ success: true, data: rows.map(attachAvailability) });
});

export const getAssignment = asyncHandler(async (req, res) => {
  const row = await Assignment.findById(req.params.id).populate(
    "course",
    "title instructor"
  );
  if (!row) throwHttp(res, 404, "Assignment not found");

  const isOwner = String(row.createdBy) === String(req.user._id);
  if (req.user.role === "student") {
    if (row.status !== "published") throwHttp(res, 404, "Assignment not found");
    const enrolled = await Enrollment.findOne({
      student: req.user._id,
      course: row.course._id || row.course,
    });
    if (!enrolled) throwHttp(res, 403, "Enroll to open this assignment");
  } else if (!isOwner && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  const availability = getWindowStatus(row.startAt, row.endAt);
  const payload = attachAvailability(row);
  payload.locked = req.user.role === "student" && !availability.canOpen;
  payload.lockMessage = availability.message;

  let mySubmission = null;
  if (req.user.role === "student") {
    mySubmission = await AssignmentSubmission.findOne({
      assignment: row._id,
      student: req.user._id,
    });
  }

  res.json({
    success: true,
    data: payload,
    availability,
    mySubmission,
  });
});

export const createAssignment = asyncHandler(async (req, res) => {
  const {
    title,
    courseId,
    instructions,
    sourceText,
    totalMarks,
    gradingMode,
    startAt,
    endAt,
    status,
  } = req.body || {};

  if (!title?.trim()) throwHttp(res, 400, "Title is required");
  if (!courseId) throwHttp(res, 400, "courseId is required");

  const course = await Course.findById(courseId);
  if (!course) throwHttp(res, 404, "Course not found");
  if (
    req.user.role === "instructor" &&
    String(course.instructor) !== String(req.user._id)
  ) {
    throwHttp(res, 403, "Not your course");
  }

  const assignment = await Assignment.create({
    title: title.trim(),
    course: courseId,
    createdBy: req.user._id,
    instructions: instructions || "",
    sourceText: sourceText || "",
    totalMarks: Number(totalMarks) > 0 ? Number(totalMarks) : 10,
    gradingMode: gradingMode === "ai" ? "ai" : "manual",
    startAt: parseDateOrNull(startAt),
    endAt: parseDateOrNull(endAt),
    status: status === "published" ? "published" : "draft",
  });

  res.status(201).json({ success: true, data: attachAvailability(assignment) });
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const row = await Assignment.findById(req.params.id);
  if (!row) throwHttp(res, 404, "Assignment not found");
  if (String(row.createdBy) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  [
    "title",
    "instructions",
    "sourceText",
    "totalMarks",
    "gradingMode",
    "status",
  ].forEach((k) => {
    if (req.body[k] !== undefined) row[k] = req.body[k];
  });
  if (req.body.startAt !== undefined) row.startAt = parseDateOrNull(req.body.startAt);
  if (req.body.endAt !== undefined) row.endAt = parseDateOrNull(req.body.endAt);

  await row.save();
  res.json({ success: true, data: attachAvailability(row) });
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  const row = await Assignment.findById(req.params.id);
  if (!row) throwHttp(res, 404, "Assignment not found");
  if (String(row.createdBy) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }
  await AssignmentSubmission.deleteMany({ assignment: row._id });
  await row.deleteOne();
  res.json({ success: true, message: "Assignment deleted" });
});

export const submitAssignment = asyncHandler(async (req, res) => {
  const row = await Assignment.findById(req.params.id);
  if (!row || row.status !== "published") {
    throwHttp(res, 404, "Assignment not found");
  }

  const enrolled = await Enrollment.findOne({
    student: req.user._id,
    course: row.course,
  });
  if (!enrolled) throwHttp(res, 403, "Not enrolled");

  const availability = getWindowStatus(row.startAt, row.endAt);
  if (!availability.canOpen) throwHttp(res, 403, availability.message);

  const textAnswer = String(req.body.textAnswer || "").trim();
  if (!textAnswer) throwHttp(res, 400, "Write your answer before submitting");

  const maxMarks = Number(row.totalMarks) > 0 ? Number(row.totalMarks) : 10;
  let marksAwarded = 0;
  let status = "pending";
  let feedback = "Awaiting instructor grading";
  let gradedBy = "";

  if (row.gradingMode === "ai") {
    try {
      const ai = await gradeWithAi({
        title: row.title,
        instructions: row.instructions,
        contextText: row.sourceText || row.instructions,
        studentAnswer: textAnswer,
        maxMarks,
      });
      marksAwarded = ai.marks;
      feedback = ai.feedback;
      gradedBy = "ai";
      status = "graded";
    } catch {
      status = "pending";
      feedback = "AI grading failed — instructor will grade manually";
    }
  }

  const submission = await AssignmentSubmission.findOneAndUpdate(
    { assignment: row._id, student: req.user._id },
    {
      textAnswer,
      marksAwarded,
      maxMarks,
      status,
      feedback,
      gradedBy,
      submittedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ success: true, data: submission });
});

export const gradeAssignmentSubmission = asyncHandler(async (req, res) => {
  const submission = await AssignmentSubmission.findById(
    req.params.submissionId
  ).populate("assignment");
  if (!submission) throwHttp(res, 404, "Submission not found");
  const assignment = submission.assignment;
  if (!assignment) throwHttp(res, 404, "Assignment not found");
  if (
    String(assignment.createdBy) !== String(req.user._id) &&
    req.user.role !== "admin"
  ) {
    throwHttp(res, 403, "Not allowed");
  }

  const maxMarks = submission.maxMarks || assignment.totalMarks || 10;
  let marks = Number(req.body.marksAwarded);
  if (!Number.isFinite(marks)) throwHttp(res, 400, "marksAwarded required");
  marks = Math.max(0, Math.min(maxMarks, marks));

  submission.marksAwarded = marks;
  submission.feedback = String(req.body.feedback || "");
  submission.status = "graded";
  submission.gradedBy = "instructor";
  await submission.save();

  res.json({ success: true, data: submission });
});

export const listAssignmentSubmissions = asyncHandler(async (req, res) => {
  const row = await Assignment.findById(req.params.id);
  if (!row) throwHttp(res, 404, "Assignment not found");
  if (String(row.createdBy) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }
  const data = await AssignmentSubmission.find({ assignment: row._id })
    .populate("student", "name email")
    .sort({ createdAt: -1 });
  res.json({ success: true, data });
});
