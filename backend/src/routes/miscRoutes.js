import { Router } from "express";
import {
  listWishlist,
  addWishlist,
  removeWishlist,
} from "../controllers/wishlistController.js";
import {
  listUsers,
  updateUser,
  listPayments,
  adminStats,
  myCertificates,
  instructorStudents,
  instructorEarnings,
  instructorStats,
  instructorAnalytics,
  instructorTopCourses,
  instructorRecentSales,
} from "../controllers/adminController.js";
import {
  listReviews,
  createReview,
  updateReview,
  deleteReview,
  markReviewHelpful,
  instructorReviews,
  replyToReview,
} from "../controllers/reviewController.js";
import { listSponsorPayments } from "../controllers/sponsorController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.get("/wishlist", protect, authorize("student"), listWishlist);
router.post("/wishlist", protect, authorize("student"), addWishlist);
router.delete("/wishlist/:courseId", protect, authorize("student"), removeWishlist);

router.get("/certificates/mine", protect, authorize("student"), myCertificates);

router.get("/admin/users", protect, authorize("admin"), listUsers);
router.patch("/admin/users/:id", protect, authorize("admin"), updateUser);
router.get("/admin/payments", protect, authorize("admin"), listPayments);
router.get(
  "/admin/sponsor-payments",
  protect,
  authorize("admin"),
  listSponsorPayments
);
router.get("/admin/stats", protect, authorize("admin"), adminStats);

router.get("/instructor/students", protect, authorize("instructor"), instructorStudents);
router.get("/instructor/earnings", protect, authorize("instructor"), instructorEarnings);
router.get("/instructor/stats", protect, authorize("instructor"), instructorStats);
router.get("/instructor/analytics", protect, authorize("instructor"), instructorAnalytics);
router.get("/instructor/top-courses", protect, authorize("instructor"), instructorTopCourses);
router.get("/instructor/recent-sales", protect, authorize("instructor"), instructorRecentSales);
router.get("/instructor/reviews", protect, authorize("instructor"), instructorReviews);
router.post(
  "/instructor/reviews/:reviewId/reply",
  protect,
  authorize("instructor"),
  replyToReview,
);

export default router;
