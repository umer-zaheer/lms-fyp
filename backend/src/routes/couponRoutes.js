import { Router } from "express";
import {
  validateCoupon,
  createCoupon,
  listCoupons,
  deleteCoupon,
} from "../controllers/couponController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.post("/validate", validateCoupon);
router.get("/", protect, authorize("instructor", "admin"), listCoupons);
router.post("/", protect, authorize("instructor", "admin"), createCoupon);
router.delete("/:id", protect, authorize("instructor", "admin"), deleteCoupon);

export default router;
