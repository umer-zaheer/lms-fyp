import path from "path";
import multer from "multer";

const storage = multer.memoryStorage();

const DOC_EXTS = new Set([
  ".pdf",
  ".ppt",
  ".pptx",
  ".doc",
  ".docx",
  ".jpeg",
  ".jpg",
  ".png",
  ".gif",
  ".webp",
  ".mp4",
  ".webm",
  ".mov",
]);

const DOC_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
]);

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = (file.mimetype || "").toLowerCase();

  const ok =
    DOC_EXTS.has(ext) ||
    DOC_MIMES.has(mime) ||
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime === "application/pdf";

  if (ok) cb(null, true);
  else cb(new Error("Unsupported file type"), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

export default upload;
