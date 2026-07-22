import { Router } from "express";
import {
  listQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  generateFromPdf,
  submitAttempt,
} from "../controllers/quizController.js";
import { protect, authorize } from "../middleware/auth.js";
import upload from "../middleware/multer.js";

const router = Router();

router.get("/", protect, listQuizzes);
router.get("/:id", protect, getQuiz);
router.post("/", protect, authorize("instructor", "admin"), createQuiz);
router.put("/:id", protect, authorize("instructor", "admin"), updateQuiz);
router.delete("/:id", protect, authorize("instructor", "admin"), deleteQuiz);
router.post(
  "/generate-from-pdf",
  protect,
  authorize("instructor", "admin", "student"),
  upload.single("file"),
  generateFromPdf
);
router.post("/:id/attempt", protect, authorize("student"), submitAttempt);

export default router;
