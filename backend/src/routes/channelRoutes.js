import { Router } from "express";
import { getCourseChannel, postMessage } from "../controllers/channelController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

router.get("/course/:courseId", protect, getCourseChannel);
router.post("/course/:courseId/messages", protect, postMessage);

export default router;
