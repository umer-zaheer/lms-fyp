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
} from "../controllers/adminController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.get("/wishlist", protect, authorize("student"), listWishlist);
router.post("/wishlist", protect, authorize("student"), addWishlist);
router.delete("/wishlist/:courseId", protect, authorize("student"), removeWishlist);

router.get("/certificates/mine", protect, authorize("student"), myCertificates);

router.get("/admin/users", protect, authorize("admin"), listUsers);
router.patch("/admin/users/:id", protect, authorize("admin"), updateUser);
router.get("/admin/payments", protect, authorize("admin"), listPayments);
router.get("/admin/stats", protect, authorize("admin"), adminStats);

router.get("/instructor/students", protect, authorize("instructor"), instructorStudents);
router.get("/instructor/earnings", protect, authorize("instructor"), instructorEarnings);

export default router;
