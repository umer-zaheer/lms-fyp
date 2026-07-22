import asyncHandler from "express-async-handler";
import Course from "../models/Course.js";
import { buildCourseSearchText } from "../utils/pricing.js";

function assertOwner(course, user) {
  const isOwner = String(course.instructor) === String(user._id);
  if (!isOwner && user.role !== "admin") {
    const err = new Error("Not allowed to edit this course");
    err.statusCode = 403;
    throw err;
  }
}

async function loadCourseOrThrow(id) {
  const course = await Course.findById(id);
  if (!course) {
    const err = new Error("Course not found");
    err.statusCode = 404;
    throw err;
  }
  return course;
}

async function refreshSearchText(course) {
  course.searchText = buildCourseSearchText(course);
  await course.save();
}

export const addModule = asyncHandler(async (req, res) => {
  const course = await loadCourseOrThrow(req.params.id);
  assertOwner(course, req.user);

  const { title, order } = req.body;
  if (!title?.trim()) {
    res.status(400);
    throw new Error("Module title is required");
  }

  course.modules.push({
    title: title.trim(),
    order: order ?? course.modules.length,
    lessons: [],
  });
  await refreshSearchText(course);

  const mod = course.modules[course.modules.length - 1];
  res.status(201).json({ success: true, data: mod, course });
});

export const updateModule = asyncHandler(async (req, res) => {
  const course = await loadCourseOrThrow(req.params.id);
  assertOwner(course, req.user);

  const mod = course.modules.id(req.params.moduleId);
  if (!mod) {
    res.status(404);
    throw new Error("Module not found");
  }

  if (req.body.title !== undefined) mod.title = req.body.title;
  if (req.body.order !== undefined) mod.order = req.body.order;
  await refreshSearchText(course);

  res.json({ success: true, data: mod, course });
});

export const deleteModule = asyncHandler(async (req, res) => {
  const course = await loadCourseOrThrow(req.params.id);
  assertOwner(course, req.user);

  const mod = course.modules.id(req.params.moduleId);
  if (!mod) {
    res.status(404);
    throw new Error("Module not found");
  }

  mod.deleteOne();
  await refreshSearchText(course);
  res.json({ success: true, message: "Module deleted", course });
});

export const addLesson = asyncHandler(async (req, res) => {
  const course = await loadCourseOrThrow(req.params.id);
  assertOwner(course, req.user);

  const mod = course.modules.id(req.params.moduleId);
  if (!mod) {
    res.status(404);
    throw new Error("Module not found");
  }

  const {
    title,
    content,
    videoUrl,
    videoPublicId,
    videoType,
    durationMinutes,
    isPreview,
    order,
  } = req.body;

  if (!title?.trim()) {
    res.status(400);
    throw new Error("Lesson title is required");
  }

  mod.lessons.push({
    title: title.trim(),
    content: content || "",
    videoUrl: videoUrl || "",
    videoPublicId: videoPublicId || "",
    videoType: videoType || (videoUrl ? "url" : ""),
    durationMinutes: Number(durationMinutes) || 0,
    isPreview: Boolean(isPreview),
    order: order ?? mod.lessons.length,
  });

  await refreshSearchText(course);
  const lesson = mod.lessons[mod.lessons.length - 1];
  res.status(201).json({ success: true, data: lesson, module: mod, course });
});

export const updateLesson = asyncHandler(async (req, res) => {
  const course = await loadCourseOrThrow(req.params.id);
  assertOwner(course, req.user);

  const mod = course.modules.id(req.params.moduleId);
  if (!mod) {
    res.status(404);
    throw new Error("Module not found");
  }

  const lesson = mod.lessons.id(req.params.lessonId);
  if (!lesson) {
    res.status(404);
    throw new Error("Lesson not found");
  }

  const fields = [
    "title",
    "content",
    "videoUrl",
    "videoPublicId",
    "videoType",
    "durationMinutes",
    "isPreview",
    "order",
  ];
  for (const key of fields) {
    if (req.body[key] !== undefined) lesson[key] = req.body[key];
  }

  await refreshSearchText(course);
  res.json({ success: true, data: lesson, course });
});

export const deleteLesson = asyncHandler(async (req, res) => {
  const course = await loadCourseOrThrow(req.params.id);
  assertOwner(course, req.user);

  const mod = course.modules.id(req.params.moduleId);
  if (!mod) {
    res.status(404);
    throw new Error("Module not found");
  }

  const lesson = mod.lessons.id(req.params.lessonId);
  if (!lesson) {
    res.status(404);
    throw new Error("Lesson not found");
  }

  lesson.deleteOne();
  await refreshSearchText(course);
  res.json({ success: true, message: "Lesson deleted", course });
});
