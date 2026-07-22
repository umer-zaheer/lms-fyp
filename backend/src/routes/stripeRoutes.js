import { Router } from "express";
import {
  platformStatus,
  platformConnect,
  platformDisconnect,
  instructorOnboard,
  instructorStripeStatus,
  verifyCheckoutSession,
} from "../controllers/stripeController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.get("/platform/status", protect, authorize("admin"), platformStatus);
router.post("/platform/connect", protect, authorize("admin"), platformConnect);
router.post("/platform/disconnect", protect, authorize("admin"), platformDisconnect);

router.post("/connect/onboard", protect, authorize("instructor"), instructorOnboard);
router.get("/connect/status", protect, authorize("instructor"), instructorStripeStatus);

router.get("/verify-session", protect, authorize("student"), verifyCheckoutSession);
router.post("/verify-session", protect, authorize("student"), verifyCheckoutSession);

export default router;
