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

  const slug = slugifyBase(name);
  if (!slug) throwHttp(res, 400, "Name is invalid");

  const exists = await Category.findOne({
    $or: [{ slug }, { name: new RegExp(`^${escapeRegex(name.trim())}$`, "i") }],
  });
  if (exists) throwHttp(res, 400, "Category already exists");

  const category = await Category.create({
    name: name.trim(),
    slug,
    description: description || "",
  });
  res.status(201).json({ success: true, data: category });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throwHttp(res, 404, "Category not found");

  if (req.body.name != null) {
    const name = String(req.body.name).trim();
    if (!name) throwHttp(res, 400, "Name is required");
    const slug = slugifyBase(name);
    const clash = await Category.findOne({
      _id: { $ne: category._id },
      $or: [{ slug }, { name: new RegExp(`^${escapeRegex(name)}$`, "i") }],
    });
    if (clash) throwHttp(res, 400, "Category already exists");
    category.name = name;
    category.slug = slug;
  }
  if (req.body.description != null) {
    category.description = String(req.body.description);
  }

  await category.save();
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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
