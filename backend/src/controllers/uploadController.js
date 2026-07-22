import asyncHandler from "express-async-handler";
import { uploadToCloudinary } from "../utils/cloudinary.js";

// @desc    Upload a single file to Cloudinary
// @route   POST /api/upload
// @access  Private
export const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file uploaded");
  }

  const folder = req.body.folder || "lms";
  const result = await uploadToCloudinary(req.file.buffer, {
    folder,
    resource_type: "auto",
  });

  res.status(201).json({
    success: true,
    data: {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      resourceType: result.resource_type,
      bytes: result.bytes,
    },
  });
});
