import { Router } from "express";
import {
  myEnrollments,
  updateProgress,
  checkoutCourse,
} from "../controllers/enrollmentController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.get("/mine", protect, authorize("student"), myEnrollments);
router.post("/:courseId/checkout", protect, authorize("student"), checkoutCourse);
router.patch("/:courseId/progress", protect, authorize("student"), updateProgress);

export default router;
