import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Review from "../models/Review.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import { throwHttp } from "../utils/helpers.js";

async function recalculateCourseRating(courseId) {
  const oid =
    typeof courseId === "string" ? new mongoose.Types.ObjectId(courseId) : courseId;

  const stats = await Review.aggregate([
    { $match: { course: oid } },
    {
      $group: {
        _id: "$course",
        avg: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);

  const course = await Course.findById(courseId);
  if (!course) return;

  if (stats[0]) {
    course.rating = Math.round(stats[0].avg * 10) / 10;
    course.ratingCount = stats[0].count;
  } else {
    course.rating = 0;
    course.ratingCount = 0;
  }
  await course.save();
}

export const listReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ course: req.params.id })
    .populate("student", "name avatar")
    .sort({ createdAt: -1 });

  res.json({ success: true, data: reviews });
});

export const createReview = asyncHandler(async (req, res) => {
  const courseId = req.params.id;
  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    throwHttp(res, 400, "Rating must be between 1 and 5");
  }
  if (!comment?.trim()) {
    throwHttp(res, 400, "Review comment is required");
  }

  const course = await Course.findById(courseId);
  if (!course || course.status !== "published") {
    throwHttp(res, 404, "Course not found");
  }

  const enrolled = await Enrollment.findOne({
    student: req.user._id,
    course: courseId,
  });
  if (!enrolled) {
    throwHttp(res, 403, "Only students who purchased this course can leave a review");
  }

  const existing = await Review.findOne({
    course: courseId,
    student: req.user._id,
  });
  if (existing) {
    throwHttp(res, 400, "You already reviewed this course. Update your existing review instead.");
  }

  const review = await Review.create({
    course: courseId,
    student: req.user._id,
    rating: Number(rating),
    comment: comment.trim(),
  });

  await recalculateCourseRating(course._id);
  await review.populate("student", "name avatar");

  res.status(201).json({ success: true, data: review });
});

export const updateReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.reviewId);
  if (!review) throwHttp(res, 404, "Review not found");

  if (String(review.student) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  if (req.body.rating != null) {
    if (req.body.rating < 1 || req.body.rating > 5) {
      throwHttp(res, 400, "Rating must be between 1 and 5");
    }
    review.rating = Number(req.body.rating);
  }
  if (req.body.comment !== undefined) {
    if (!req.body.comment.trim()) throwHttp(res, 400, "Comment required");
    review.comment = req.body.comment.trim();
  }

  await review.save();
  await recalculateCourseRating(review.course);
  await review.populate("student", "name avatar");

  res.json({ success: true, data: review });
});

export const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.reviewId);
  if (!review) throwHttp(res, 404, "Review not found");

  if (String(review.student) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  const courseId = review.course;
  await review.deleteOne();
  await recalculateCourseRating(courseId);

  res.json({ success: true, message: "Review deleted" });
});
