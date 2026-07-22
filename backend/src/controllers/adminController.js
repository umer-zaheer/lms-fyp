import asyncHandler from "express-async-handler";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Payment from "../models/Payment.js";
import Enrollment from "../models/Enrollment.js";
import Certificate from "../models/Certificate.js";
import { throwHttp } from "../utils/helpers.js";

export const listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.q) {
    filter.$or = [
      { name: new RegExp(req.query.q, "i") },
      { email: new RegExp(req.query.q, "i") },
    ];
  }
  const data = await User.find(filter)
    .select("-password")
    .sort({ createdAt: -1 });
  res.json({ success: true, data });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throwHttp(res, 404, "User not found");

  // Keep single admin: cannot demote last admin or create second admin casually
  if (req.body.role === "admin" && user.role !== "admin") {
    const adminCount = await User.countDocuments({ role: "admin" });
    if (adminCount >= 1) throwHttp(res, 400, "Only one admin is allowed");
  }

  if (req.body.role && user.role === "admin" && req.body.role !== "admin") {
    throwHttp(res, 400, "Cannot demote the platform admin");
  }

  if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
  if (req.body.role && ["student", "instructor"].includes(req.body.role)) {
    user.role = req.body.role;
  }
  await user.save();
  res.json({ success: true, data: user });
});

export const listPayments = asyncHandler(async (_req, res) => {
  const data = await Payment.find()
    .populate("student", "name email")
    .populate("instructor", "name email")
    .populate("course", "title")
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ success: true, data });
});

export const adminStats = asyncHandler(async (_req, res) => {
  const [students, instructors, courses, revenueAgg, enrollments] =
    await Promise.all([
      User.countDocuments({ role: "student" }),
      User.countDocuments({ role: "instructor" }),
      Course.countDocuments(),
      Payment.aggregate([
        { $match: { status: "paid" } },
        {
          $group: {
            _id: null,
            total: { $sum: "$amountTotal" },
            platform: { $sum: "$platformFee" },
          },
        },
      ]),
      Enrollment.countDocuments(),
    ]);

  res.json({
    success: true,
    data: {
      totalStudents: students,
      totalInstructors: instructors,
      totalCourses: courses,
      totalEnrollments: enrollments,
      totalRevenue: revenueAgg[0]?.total || 0,
      platformRevenue: revenueAgg[0]?.platform || 0,
    },
  });
});

export const myCertificates = asyncHandler(async (req, res) => {
  const data = await Certificate.find({ student: req.user._id })
    .populate("course", "title thumbnail")
    .sort({ issuedAt: -1 });
  res.json({ success: true, data });
});

export const instructorStudents = asyncHandler(async (req, res) => {
  const courses = await Course.find({ instructor: req.user._id }).select(
    "_id title",
  );
  const ids = courses.map((c) => c._id);
  const data = await Enrollment.find({ course: { $in: ids } })
    .populate("student", "name email avatar")
    .populate("course", "title")
    .sort({ updatedAt: -1 });
  res.json({ success: true, data });
});

export const instructorEarnings = asyncHandler(async (req, res) => {
  const payments = await Payment.find({
    instructor: req.user._id,
    status: "paid",
  })
    .populate("course", "title")
    .populate("student", "name")
    .sort({ createdAt: -1 });

  const total = payments.reduce((s, p) => s + (p.instructorAmount || 0), 0);
  res.json({ success: true, data: { total, payments } });
});
