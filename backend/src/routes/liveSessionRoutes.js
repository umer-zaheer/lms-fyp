import { Router } from "express";
import {
  listInstructorSessions,
  listStudentSessions,
  createScheduledSession,
  goLiveInstant,
  getSessionById,
  getSessionByCode,
  startSession,
  endSession,
  requestJoin,
  getJoinRequestStatus,
  listJoinRequests,
  respondJoinRequest,
  getZegoCredentials,
} from "../controllers/liveSessionController.js";
import { protect, authorize, optionalProtect } from "../middleware/auth.js";

const router = Router();

router.get("/code/:code", getSessionByCode);

router.get(
  "/instructor",
  protect,
  authorize("instructor"),
  listInstructorSessions,
);
router.get("/student", protect, authorize("student"), listStudentSessions);

router.post(
  "/scheduled",
  protect,
  authorize("instructor"),
  createScheduledSession,
);
router.post("/go-live", protect, authorize("instructor"), goLiveInstant);

router.get("/:id", protect, getSessionById);
router.post("/:id/start", protect, authorize("instructor"), startSession);
router.post("/:id/end", protect, authorize("instructor"), endSession);

router.post("/:id/join-request", optionalProtect, requestJoin);
router.get(
  "/:id/join-request/:requestId",
  optionalProtect,
  getJoinRequestStatus,
);
router.get(
  "/:id/join-requests",
  protect,
  authorize("instructor"),
  listJoinRequests,
);
router.patch(
  "/:id/join-requests/:requestId",
  protect,
  authorize("instructor"),
  respondJoinRequest,
);

router.post("/:id/zego-token", optionalProtect, getZegoCredentials);

export default router;
