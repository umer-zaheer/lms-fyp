import { Router } from "express";
import {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
} from "../controllers/courseController.js";
import {
  addModule,
  updateModule,
  deleteModule,
  addLesson,
  updateLesson,
  deleteLesson,
  addLessonVideo,
  deleteLessonVideo,
  addLessonDocument,
  deleteLessonDocument,
  chatLessonDocument,
} from "../controllers/curriculumController.js";
import {
  listReviews,
  createReview,
  updateReview,
  deleteReview,
  markReviewHelpful,
} from "../controllers/reviewController.js";
import { protect, authorize } from "../middleware/auth.js";
import upload from "../middleware/multer.js";

const router = Router();

const optionalAuth = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ") || req.cookies?.token) {
    return protect(req, _res, next);
  }
  next();
};

router.get("/", optionalAuth, listCourses);
router.get("/:id", optionalAuth, getCourse);
router.post("/", protect, authorize("instructor", "admin"), createCourse);
router.put("/:id", protect, authorize("instructor", "admin"), updateCourse);
router.delete("/:id", protect, authorize("instructor", "admin"), deleteCourse);

// Modules & lessons (instructor / admin)
router.post("/:id/modules", protect, authorize("instructor", "admin"), addModule);
router.put(
  "/:id/modules/:moduleId",
  protect,
  authorize("instructor", "admin"),
  updateModule
);
router.delete(
  "/:id/modules/:moduleId",
  protect,
  authorize("instructor", "admin"),
  deleteModule
);
router.post(
  "/:id/modules/:moduleId/lessons",
  protect,
  authorize("instructor", "admin"),
  addLesson
);
router.put(
  "/:id/modules/:moduleId/lessons/:lessonId",
  protect,
  authorize("instructor", "admin"),
  updateLesson
);
router.delete(
  "/:id/modules/:moduleId/lessons/:lessonId",
  protect,
  authorize("instructor", "admin"),
  deleteLesson
);
router.post(
  "/:id/modules/:moduleId/lessons/:lessonId/videos",
  protect,
  authorize("instructor", "admin"),
  addLessonVideo
);
router.delete(
  "/:id/modules/:moduleId/lessons/:lessonId/videos/:videoId",
  protect,
  authorize("instructor", "admin"),
  deleteLessonVideo
);

router.post(
  "/:id/modules/:moduleId/lessons/:lessonId/documents",
  protect,
  authorize("instructor", "admin"),
  upload.single("file"),
  addLessonDocument
);
router.delete(
  "/:id/modules/:moduleId/lessons/:lessonId/documents/:docId",
  protect,
  authorize("instructor", "admin"),
  deleteLessonDocument
);
router.post(
  "/:id/lessons/:lessonId/documents/:docId/chat",
  protect,
  chatLessonDocument
);

// Reviews — anyone can list; only enrolled students can create
router.get("/:id/reviews", listReviews);
router.post("/:id/reviews", protect, authorize("student"), createReview);
router.put("/:id/reviews/:reviewId", protect, updateReview);
router.delete("/:id/reviews/:reviewId", protect, deleteReview);
router.post(
  "/:id/reviews/:reviewId/helpful",
  protect,
  markReviewHelpful,
);

export default router;
