import asyncHandler from "express-async-handler";
import Category from "../models/Category.js";
import { throwHttp } from "../utils/helpers.js";

export const listCategories = asyncHandler(async (_req, res) => {
  const categories = await Category.find().sort({ name: 1 });
  res.json({ success: true, data: categories });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) throwHttp(res, 400, "Name is required");

  const slug = makeSlug(name).replace(/-[a-z0-9]{5}$/, "");
  const exists = await Category.findOne({ slug: slugifyBase(name) });
  if (exists) throwHttp(res, 400, "Category already exists");

  const category = await Category.create({
    name,
    slug: slugifyBase(name),
    description: description || "",
  });
  res.status(201).json({ success: true, data: category });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!category) throwHttp(res, 404, "Category not found");
  res.json({ success: true, data: category });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) throwHttp(res, 404, "Category not found");
  res.json({ success: true, message: "Category deleted" });
});

function slugifyBase(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
