import asyncHandler from "express-async-handler";
import Coupon from "../models/Coupon.js";
import Course from "../models/Course.js";
import { applyCouponToCourse } from "../utils/pricing.js";
import { throwHttp } from "../utils/helpers.js";

export const validateCoupon = asyncHandler(async (req, res) => {
  const { code, courseId } = req.body;
  const course = await Course.findById(courseId).populate("category");
  if (!course) throwHttp(res, 404, "Course not found");

  const result = await applyCouponToCourse(course, code);
  res.json({
    success: true,
    data: {
      code: result.coupon?.code,
      percentOff: result.percentOff,
      originalPrice: course.price,
      finalPrice: result.finalPrice,
      type: result.coupon?.type,
    },
  });
});

export const createCoupon = asyncHandler(async (req, res) => {
  const { code, type, percentOff, courseId, categoryId, maxUses, expiresAt } = req.body;

  if (!code || !type || !percentOff) {
    throwHttp(res, 400, "code, type, and percentOff are required");
  }

  if (type === "course") {
    if (req.user.role !== "instructor" && req.user.role !== "admin") {
      throwHttp(res, 403, "Only instructors can create course coupons");
    }
    const course = await Course.findById(courseId);
    if (!course) throwHttp(res, 404, "Course not found");
    if (
      req.user.role === "instructor" &&
      String(course.instructor) !== String(req.user._id)
    ) {
      throwHttp(res, 403, "Not your course");
    }
  }

  if (type === "category") {
    if (req.user.role !== "admin") {
      throwHttp(res, 403, "Only admin can create category discounts");
    }
    if (!categoryId) throwHttp(res, 400, "categoryId required");
  }

  const coupon = await Coupon.create({
    code: code.toUpperCase().trim(),
    type,
    percentOff: Number(percentOff),
    course: type === "course" ? courseId : undefined,
    category: type === "category" ? categoryId : undefined,
    createdBy: req.user._id,
    maxUses: maxUses ?? null,
    expiresAt: expiresAt || undefined,
  });

  res.status(201).json({ success: true, data: coupon });
});

export const listCoupons = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === "instructor") {
    filter.createdBy = req.user._id;
    filter.type = "course";
  } else if (req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  const data = await Coupon.find(filter)
    .populate("course", "title")
    .populate("category", "name")
    .sort({ createdAt: -1 });

  res.json({ success: true, data });
});

export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throwHttp(res, 404, "Coupon not found");

  if (
    req.user.role !== "admin" &&
    String(coupon.createdBy) !== String(req.user._id)
  ) {
    throwHttp(res, 403, "Not allowed");
  }

  await coupon.deleteOne();
  res.json({ success: true, message: "Coupon deleted" });
});
