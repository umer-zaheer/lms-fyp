import { Router } from "express";
import { searchCourses } from "../controllers/searchController.js";

const router = Router();

router.get("/courses", searchCourses);
router.post("/courses", searchCourses);

export default router;
