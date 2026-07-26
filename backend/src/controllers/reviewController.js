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
  if (comment.trim().length > 250) {
    throwHttp(res, 400, "Comment must be 250 characters or less");
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

export const markReviewHelpful = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.reviewId);
  if (!review) throwHttp(res, 404, "Review not found");
  if (String(review.course) !== String(req.params.id)) {
    throwHttp(res, 400, "Review does not belong to this course");
  }

  const userId = String(req.user._id);
  const already = (review.helpfulBy || []).some((id) => String(id) === userId);
  if (already) {
    return res.json({
      success: true,
      data: review,
      message: "Already marked helpful",
    });
  }

  review.helpfulBy = review.helpfulBy || [];
  review.helpfulBy.push(req.user._id);
  review.helpfulCount = (review.helpfulCount || 0) + 1;
  await review.save();
  await review.populate("student", "name avatar");

  res.json({ success: true, data: review });
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
    if (req.body.comment.trim().length > 250) {
      throwHttp(res, 400, "Comment must be 250 characters or less");
    }
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

/** All reviews across the logged-in instructor's courses */
export const instructorReviews = asyncHandler(async (req, res) => {
  const courses = await Course.find({ instructor: req.user._id }).select("_id title");
  const courseIds = courses.map((c) => c._id);
  const courseTitle = new Map(courses.map((c) => [String(c._id), c.title]));

  const filter = { course: { $in: courseIds } };
  const status = String(req.query.status || "all").toLowerCase();
  if (status === "unanswered") {
    filter.$or = [
      { sellerResponse: { $exists: false } },
      { sellerResponse: "" },
      { sellerResponse: null },
    ];
  } else if (status === "replied") {
    filter.sellerResponse = { $exists: true, $nin: ["", null] };
  } else if (status === "low") {
    filter.rating = { $lte: 3 };
  }

  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const reviews = await Review.find(filter)
    .populate("student", "name email avatar")
    .populate("course", "title thumbnail")
    .sort({ createdAt: -1 })
    .limit(limit);

  const data = reviews.map((r) => ({
    id: r._id,
    rating: r.rating,
    comment: r.comment,
    sellerResponse: r.sellerResponse || "",
    sellerRespondedAt: r.sellerRespondedAt || null,
    replied: Boolean(r.sellerResponse && String(r.sellerResponse).trim()),
    helpfulCount: r.helpfulCount || 0,
    createdAt: r.createdAt,
    student: r.student?.name || "Student",
    studentEmail: r.student?.email || "",
    studentAvatar: r.student?.avatar?.url || null,
    course: r.course?.title || courseTitle.get(String(r.course)) || "Course",
    courseId: r.course?._id || r.course,
    courseThumbnail: r.course?.thumbnail?.url || null,
  }));

  const allForStats = await Review.find({ course: { $in: courseIds } }).select(
    "rating sellerResponse",
  );
  const avg =
    allForStats.length > 0
      ? allForStats.reduce((s, r) => s + (r.rating || 0), 0) / allForStats.length
      : 0;
  const unanswered = allForStats.filter(
    (r) => !r.sellerResponse || !String(r.sellerResponse).trim(),
  ).length;
  const low = allForStats.filter((r) => (r.rating || 0) <= 3).length;

  res.json({
    success: true,
    data,
    meta: {
      total: allForStats.length,
      avgRating: Math.round(avg * 10) / 10,
      unanswered,
      low,
    },
  });
});

/** Instructor replies to a review on their own course */
export const replyToReview = asyncHandler(async (req, res) => {
  const { response } = req.body;
  if (!response?.trim()) throwHttp(res, 400, "Reply is required");
  if (response.trim().length > 250) {
    throwHttp(res, 400, "Reply must be 250 characters or less");
  }

  const review = await Review.findById(req.params.reviewId).populate(
    "course",
    "instructor title",
  );
  if (!review) throwHttp(res, 404, "Review not found");

  const courseInstructor = review.course?.instructor;
  if (String(courseInstructor) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "You can only reply to reviews on your courses");
  }

  review.sellerResponse = response.trim();
  review.sellerRespondedAt = new Date();
  await review.save();
  await review.populate("student", "name email avatar");
  await review.populate("course", "title thumbnail");

  res.json({
    success: true,
    data: {
      id: review._id,
      rating: review.rating,
      comment: review.comment,
      sellerResponse: review.sellerResponse,
      sellerRespondedAt: review.sellerRespondedAt,
      replied: true,
      student: review.student?.name || "Student",
      course: review.course?.title || "Course",
      courseId: review.course?._id || review.course,
      createdAt: review.createdAt,
    },
  });
});
