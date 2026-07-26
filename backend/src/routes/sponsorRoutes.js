import { Router } from "express";
import {
  listFeaturedSponsored,
  instructorSponsorOverview,
  createSponsorship,
  updateSponsorship,
  endSponsorship,
  trackSponsorClick,
  verifySponsorCheckout,
} from "../controllers/sponsorController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

/** Public */
router.get("/featured", listFeaturedSponsored);

/** Instructor — static paths before param routes */
router.get(
  "/instructor",
  protect,
  authorize("instructor"),
  instructorSponsorOverview
);
router.post(
  "/verify-session",
  protect,
  authorize("instructor"),
  verifySponsorCheckout
);
router.post("/", protect, authorize("instructor"), createSponsorship);
router.patch("/:id", protect, authorize("instructor"), updateSponsorship);
router.delete("/:id", protect, authorize("instructor"), endSponsorship);

/** Public click tracking */
router.post("/:courseId/click", trackSponsorClick);

export default router;
