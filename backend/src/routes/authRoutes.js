import { Router } from "express";
import {
  register,
  login,
  getMe,
  updateMe,
  logout,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", protect, getMe);
router.patch("/me", protect, updateMe);

export default router;
