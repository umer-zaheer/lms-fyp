import asyncHandler from "express-async-handler";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import Review from "../models/Review.js";
import { makeSlug, throwHttp } from "../utils/helpers.js";
import { buildCourseSearchText } from "../utils/pricing.js";
import { embedText } from "../utils/openrouter.js";
import {
  getActiveSponsoredRows,
  mergeSponsoredFirst,
} from "../utils/sponsor.js";
import { getPublishReadiness } from "../utils/curriculum.js";

export const listCourses = asyncHandler(async (req, res) => {
  const {
    q,
    category,
    level,
    status,
    instructor,
    minPrice,
    maxPrice,
    page = 1,
    limit = 20,
  } = req.query;

  const filter = {};

  if (req.user?.role === "admin") {
    if (status) filter.status = status;
  } else if (req.user?.role === "instructor" && instructor === "me") {
    filter.instructor = req.user._id;
  } else {
    filter.status = "published";
  }

  if (category) filter.category = category;
  if (level) filter.level = level;
  if (instructor && instructor !== "me") filter.instructor = instructor;
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }
  if (q) filter.$text = { $search: q };

  const isPublicBrowse =
    filter.status === "published" &&
    !(req.user?.role === "instructor" && instructor === "me") &&
    req.user?.role !== "admin";

  const skip = (Number(page) - 1) * Number(limit);
  const [raw, total] = await Promise.all([
    Course.find(filter)
      .populate("instructor", "name email avatar")
      .populate("category", "name slug")
      .sort(q ? { score: { $meta: "textScore" } } : { createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Course.countDocuments(filter),
  ]);

  let data = raw;
  if (isPublicBrowse && Number(page) === 1 && !q) {
    const sponsored = await getActiveSponsoredRows(Number(limit));
    data = mergeSponsoredFirst(raw, sponsored, Number(limit));
  }

  res.json({
    success: true,
    data,
    meta: { total, page: Number(page), limit: Number(limit) },
  });
});

export const getCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id)
    .populate("instructor", "name email avatar stripeOnboardingComplete")
    .populate("category", "name slug");

  if (!course) throwHttp(res, 404, "Course not found");

  const isOwner =
    req.user && String(course.instructor._id) === String(req.user._id);
  const isAdmin = req.user?.role === "admin";

  if (course.status !== "published" && !isOwner && !isAdmin) {
    throwHttp(res, 404, "Course not found");
  }

  let enrolled = false;
  let myReview = null;
  if (req.user) {
    enrolled = Boolean(
      await Enrollment.findOne({ student: req.user._id, course: course._id })
    );
    myReview = await Review.findOne({
      course: course._id,
      student: req.user._id,
    });
  }

  // Hide non-preview videos/docs from non-enrolled viewers (except owner/admin)
  const payload = course.toObject();
  for (const mod of payload.modules || []) {
    for (const lesson of mod.lessons || []) {
      if (Array.isArray(lesson.documents)) {
        lesson.documents = lesson.documents.map((d) => {
          const { extractedText, ...rest } = d;
          return rest;
        });
      }
      if (!enrolled && !isOwner && !isAdmin && !lesson.isPreview) {
        lesson.videoUrl = "";
        lesson.videoPublicId = "";
        lesson.content = lesson.content ? "[Enroll to unlock]" : "";
        if (Array.isArray(lesson.videos)) {
          lesson.videos = lesson.videos.map((v) => ({
            ...v,
            videoUrl: "",
            videoPublicId: "",
          }));
        }
        if (Array.isArray(lesson.documents)) {
          lesson.documents = lesson.documents.map((d) => ({
            ...d,
            fileUrl: "",
            filePublicId: "",
          }));
        }
      }
    }
  }

  const reviews = await Review.find({ course: course._id })
    .populate("student", "name avatar")
    .sort({ createdAt: -1 })
    .limit(50);

  res.json({
    success: true,
    data: payload,
    enrolled,
    reviews,
    myReview,
    publishReadiness:
      isOwner || isAdmin ? getPublishReadiness(course) : undefined,
  });
});

export const createCourse = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    shortDescription,
    category,
    price,
    level,
    thumbnail,
    modules,
    tags,
  } = req.body;

  if (!title || !category || price == null) {
    throwHttp(res, 400, "title, category, and price are required");
  }

  // New courses always start as draft — publish only after curriculum + videos
  const course = await Course.create({
    title,
    slug: makeSlug(title),
    description: description || "",
    shortDescription: shortDescription || "",
    instructor: req.user._id,
    category,
    price: Number(price),
    level: level || "all",
    thumbnail: thumbnail || {},
    modules: modules || [],
    tags: tags || [],
    status: "draft",
    searchText: "",
  });

  course.searchText = buildCourseSearchText(course);
  await course.save();

  // Best-effort embedding for RAG (non-blocking failure)
  try {
    if (process.env.OPENROUTER_API_KEY) {
      course.embedding = await embedText(course.searchText);
      await course.save();
    }
  } catch (e) {
    console.warn("Embedding skipped:", e.message);
  }

  res.status(201).json({ success: true, data: course });
});

export const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) throwHttp(res, 404, "Course not found");

  const isOwner = String(course.instructor) === String(req.user._id);
  if (!isOwner && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed to update this course");
  }

  const allowed = [
    "title",
    "description",
    "shortDescription",
    "category",
    "price",
    "level",
    "thumbnail",
    "modules",
    "tags",
    "status",
  ];

  for (const key of allowed) {
    if (req.body[key] !== undefined) course[key] = req.body[key];
  }

  if (req.body.title) course.slug = makeSlug(req.body.title);

  // Gate publish: modules + lessons + each lesson has ≥1 video
  if (course.status === "published") {
    const readiness = getPublishReadiness(course);
    if (!readiness.canPublish) {
      throwHttp(
        res,
        400,
        readiness.issues[0] ||
          "Add modules, lessons, and at least one video per lesson before publishing"
      );
    }
  }

  course.searchText = buildCourseSearchText(course);
  await course.save();

  try {
    if (process.env.OPENROUTER_API_KEY) {
      course.embedding = await embedText(course.searchText);
      await course.save();
    }
  } catch (e) {
    console.warn("Embedding skipped:", e.message);
  }

  res.json({ success: true, data: course });
});

export const deleteCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) throwHttp(res, 404, "Course not found");

  const isOwner = String(course.instructor) === String(req.user._id);
  if (!isOwner && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  await course.deleteOne();
  res.json({ success: true, message: "Course deleted" });
});
