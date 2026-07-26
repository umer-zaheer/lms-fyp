import asyncHandler from "express-async-handler";
import Course from "../models/Course.js";
import { buildCourseSearchText } from "../utils/pricing.js";
import { syncLessonPrimaryVideo } from "../utils/curriculum.js";

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

function normalizeVideosInput(videos, fallback = {}) {
  if (!Array.isArray(videos)) return null;
  return videos
    .filter((v) => v && (v.videoUrl || v.url))
    .map((v, i) => ({
      title: (v.title || `Video ${i + 1}`).trim(),
      videoUrl: v.videoUrl || v.url || "",
      videoPublicId: v.videoPublicId || v.publicId || "",
      videoType: v.videoType || (v.videoUrl || v.url ? "url" : "upload"),
      durationMinutes: Number(v.durationMinutes) || 0,
      order: v.order ?? i,
    }));
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
    videos,
    durationMinutes,
    isPreview,
    order,
  } = req.body;

  if (!title?.trim()) {
    res.status(400);
    throw new Error("Lesson title is required");
  }

  let videoList = normalizeVideosInput(videos);
  if (!videoList?.length && videoUrl) {
    videoList = [
      {
        title: "Video 1",
        videoUrl,
        videoPublicId: videoPublicId || "",
        videoType: videoType || "url",
        durationMinutes: Number(durationMinutes) || 0,
        order: 0,
      },
    ];
  }

  const lessonData = {
    title: title.trim(),
    content: content || "",
    videoUrl: "",
    videoPublicId: "",
    videoType: "",
    videos: videoList || [],
    durationMinutes: Number(durationMinutes) || 0,
    isPreview: Boolean(isPreview),
    order: order ?? mod.lessons.length,
  };

  syncLessonPrimaryVideo(lessonData);
  mod.lessons.push(lessonData);

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

  if (req.body.videos !== undefined) {
    const list = normalizeVideosInput(req.body.videos);
    lesson.videos = list || [];
  }

  syncLessonPrimaryVideo(lesson);
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

/** Add a video to an existing lesson */
export const addLessonVideo = asyncHandler(async (req, res) => {
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

  const { title, videoUrl, videoPublicId, videoType, durationMinutes } =
    req.body || {};
  if (!videoUrl?.trim()) {
    res.status(400);
    throw new Error("videoUrl is required");
  }

  if (!Array.isArray(lesson.videos)) lesson.videos = [];
  // Migrate legacy single video into array if needed
  syncLessonPrimaryVideo(lesson);

  lesson.videos.push({
    title: (title || `Video ${lesson.videos.length + 1}`).trim(),
    videoUrl: videoUrl.trim(),
    videoPublicId: videoPublicId || "",
    videoType: videoType || "upload",
    durationMinutes: Number(durationMinutes) || 0,
    order: lesson.videos.length,
  });

  syncLessonPrimaryVideo(lesson);
  await refreshSearchText(course);
  res.status(201).json({ success: true, data: lesson, course });
});

export const deleteLessonVideo = asyncHandler(async (req, res) => {
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

  const vid = lesson.videos?.id?.(req.params.videoId);
  if (!vid) {
    res.status(404);
    throw new Error("Video not found");
  }

  vid.deleteOne();
  syncLessonPrimaryVideo(lesson);
  // If no videos left, clear primary
  if (!lesson.videos?.length) {
    lesson.videoUrl = "";
    lesson.videoPublicId = "";
    lesson.videoType = "";
  }
  await refreshSearchText(course);
  res.json({ success: true, data: lesson, course });
});
