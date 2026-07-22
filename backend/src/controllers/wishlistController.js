import asyncHandler from "express-async-handler";
import Wishlist from "../models/Wishlist.js";
import Course from "../models/Course.js";
import { throwHttp } from "../utils/helpers.js";

export const listWishlist = asyncHandler(async (req, res) => {
  const data = await Wishlist.find({ student: req.user._id })
    .populate({
      path: "course",
      populate: [
        { path: "instructor", select: "name" },
        { path: "category", select: "name" },
      ],
    })
    .sort({ createdAt: -1 });
  res.json({ success: true, data });
});

export const addWishlist = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.body.courseId);
  if (!course || course.status !== "published") {
    throwHttp(res, 404, "Course not found");
  }
  const item = await Wishlist.findOneAndUpdate(
    { student: req.user._id, course: course._id },
    { student: req.user._id, course: course._id },
    { upsert: true, new: true }
  );
  res.status(201).json({ success: true, data: item });
});

export const removeWishlist = asyncHandler(async (req, res) => {
  await Wishlist.findOneAndDelete({
    student: req.user._id,
    course: req.params.courseId,
  });
  res.json({ success: true, message: "Removed" });
});
