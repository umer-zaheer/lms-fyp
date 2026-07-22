import { Router } from "express";
import { uploadFile } from "../controllers/uploadController.js";
import { protect } from "../middleware/auth.js";
import upload from "../middleware/multer.js";

const router = Router();

router.post("/", protect, upload.single("file"), uploadFile);

export default router;
