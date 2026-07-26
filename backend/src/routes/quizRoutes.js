import { Router } from "express";
import {
  listQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  generateFromPdf,
  generateFromText,
  submitAttempt,
  gradeAttempt,
  listQuizAttempts,
} from "../controllers/quizController.js";
import { protect, authorize } from "../middleware/auth.js";
import upload from "../middleware/multer.js";

const router = Router();

router.get("/", protect, listQuizzes);
router.post(
  "/generate-from-pdf",
  protect,
  authorize("instructor", "admin", "student"),
  upload.single("file"),
  generateFromPdf
);
router.post(
  "/generate-from-text",
  protect,
  authorize("instructor", "admin"),
  generateFromText
);
router.get("/:id", protect, getQuiz);
router.post("/", protect, authorize("instructor", "admin"), createQuiz);
router.put("/:id", protect, authorize("instructor", "admin"), updateQuiz);
router.delete("/:id", protect, authorize("instructor", "admin"), deleteQuiz);
router.post("/:id/attempt", protect, authorize("student"), submitAttempt);
router.get(
  "/:id/attempts",
  protect,
  authorize("instructor", "admin"),
  listQuizAttempts
);
router.patch(
  "/attempts/:attemptId/grade",
  protect,
  authorize("instructor", "admin"),
  gradeAttempt
);

export default router;
