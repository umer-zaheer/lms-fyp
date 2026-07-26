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

function sanitizeLessonDocs(lesson) {
  if (!lesson) return lesson;
  const obj =
    typeof lesson.toObject === "function" ? lesson.toObject() : { ...lesson };
  if (Array.isArray(obj.documents)) {
    obj.documents = obj.documents.map((d) => {
      const { extractedText, ...rest } = d;
      return rest;
    });
  }
  return obj;
}

function sanitizeCourseDocs(course) {
  const obj =
    typeof course.toObject === "function" ? course.toObject() : { ...course };
  for (const mod of obj.modules || []) {
    for (const lesson of mod.lessons || []) {
      if (Array.isArray(lesson.documents)) {
        lesson.documents = lesson.documents.map((d) => {
          const { extractedText, ...rest } = d;
          return rest;
        });
      }
    }
  }
  return obj;
}

/** Upload PDF/PPTX/DOCX to a lesson (+ extract text for chat) */
export const addLessonDocument = asyncHandler(async (req, res) => {
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

  if (!req.file) {
    res.status(400);
    throw new Error("No file uploaded");
  }

  const { extractDocumentText, detectFileType } = await import(
    "../utils/documentExtract.js"
  );
  const { uploadToCloudinary } = await import("../utils/cloudinary.js");

  let extractedText = "";
  let fileType = detectFileType(req.file.originalname, req.file.mimetype);
  try {
    const extracted = await extractDocumentText(req.file.buffer, {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    extractedText = extracted.text || "";
    fileType = extracted.fileType || fileType;
  } catch (e) {
    if (e.statusCode === 400) {
      res.status(400);
      throw e;
    }
    extractedText = "";
  }

  const uploaded = await uploadToCloudinary(req.file.buffer, {
    folder: req.body.folder || "lms/lesson-docs",
    resource_type: "auto",
  });

  if (!Array.isArray(lesson.documents)) lesson.documents = [];

  const title =
    (req.body.title || "").trim() ||
    String(req.file.originalname || "Document")
      .replace(/\.[^.]+$/, "")
      .trim();

  lesson.documents.push({
    title,
    fileUrl: uploaded.secure_url,
    filePublicId: uploaded.public_id || "",
    fileType,
    mimeType: req.file.mimetype || "",
    bytes: req.file.size || uploaded.bytes || 0,
    extractedText,
    hasText: extractedText.length >= 40,
    order: lesson.documents.length,
  });

  await refreshSearchText(course);

  const savedDoc = lesson.documents[lesson.documents.length - 1];
  res.status(201).json({
    success: true,
    data: sanitizeLessonDocs({ documents: [savedDoc] }).documents[0],
    lesson: sanitizeLessonDocs(lesson),
    course: sanitizeCourseDocs(course),
    message:
      extractedText.length >= 40
        ? "Document uploaded — students can chat with it"
        : "Document uploaded — little text found; chat may be limited",
  });
});

export const deleteLessonDocument = asyncHandler(async (req, res) => {
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

  const doc = lesson.documents?.id?.(req.params.docId);
  if (!doc) {
    res.status(404);
    throw new Error("Document not found");
  }

  doc.deleteOne();
  await refreshSearchText(course);
  res.json({
    success: true,
    message: "Document deleted",
    lesson: sanitizeLessonDocs(lesson),
    course: sanitizeCourseDocs(course),
  });
});

/** Student (or owner) asks a question about a lesson document */
export const chatLessonDocument = asyncHandler(async (req, res) => {
  const Enrollment = (await import("../models/Enrollment.js")).default;
  const { answerFromDocument } = await import("../utils/openrouter.js");

  const course = await loadCourseOrThrow(req.params.id);
  const isOwner =
    String(course.instructor) === String(req.user._id) ||
    req.user.role === "admin";

  let enrolled = isOwner;
  if (!enrolled) {
    enrolled = Boolean(
      await Enrollment.findOne({
        student: req.user._id,
        course: course._id,
      }),
    );
  }
  if (!enrolled) {
    res.status(403);
    throw new Error("Enroll in this course to chat with documents");
  }

  let lesson = null;
  for (const mod of course.modules || []) {
    const found = mod.lessons?.id?.(req.params.lessonId);
    if (found) {
      lesson = found;
      break;
    }
  }
  if (!lesson) {
    res.status(404);
    throw new Error("Lesson not found");
  }

  const doc = lesson.documents?.id?.(req.params.docId);
  if (!doc) {
    res.status(404);
    throw new Error("Document not found");
  }

  const question = String(req.body?.question || "").trim();
  if (!question) {
    res.status(400);
    throw new Error("question is required");
  }
  if (question.length > 2000) {
    res.status(400);
    throw new Error("Question is too long");
  }

  const context = String(doc.extractedText || "").trim();
  if (context.length < 40) {
    res.status(400);
    throw new Error(
      "This document has little readable text for chat. Try a text-based PDF, DOCX, or PPTX.",
    );
  }

  const answer = await answerFromDocument({
    documentTitle: doc.title || "Lesson document",
    documentText: context,
    question,
  });

  res.json({
    success: true,
    data: {
      answer: String(answer || "").trim(),
      documentId: String(doc._id),
      documentTitle: doc.title || "Document",
    },
  });
});
