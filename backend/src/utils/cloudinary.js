import cloudinary from "../config/cloudinary.js";

/**
 * Upload a buffer (from multer memoryStorage) to Cloudinary.
 * @param {Buffer} buffer
 * @param {object} options - folder, resource_type, public_id, etc.
 * @returns {Promise<object>} Cloudinary upload result
 */
export const uploadToCloudinary = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "auto",
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
};

/**
 * Delete a file from Cloudinary by public_id.
 */
export const deleteFromCloudinary = async (publicId, resourceType = "image") => {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};
