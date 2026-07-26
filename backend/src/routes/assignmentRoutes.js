import { Router } from "express";
import {
  listAssignments,
  getAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  submitAssignment,
  gradeAssignmentSubmission,
  listAssignmentSubmissions,
} from "../controllers/assignmentController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.get("/", protect, listAssignments);
router.get("/:id", protect, getAssignment);
router.post("/", protect, authorize("instructor", "admin"), createAssignment);
router.put("/:id", protect, authorize("instructor", "admin"), updateAssignment);
router.delete(
  "/:id",
  protect,
  authorize("instructor", "admin"),
  deleteAssignment
);
router.post(
  "/:id/submit",
  protect,
  authorize("student"),
  submitAssignment
);
router.get(
  "/:id/submissions",
  protect,
  authorize("instructor", "admin"),
  listAssignmentSubmissions
);
router.patch(
  "/submissions/:submissionId/grade",
  protect,
  authorize("instructor", "admin"),
  gradeAssignmentSubmission
);

export default router;
