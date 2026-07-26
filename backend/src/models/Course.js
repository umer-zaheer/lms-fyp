import mongoose from "mongoose";

const videoItemSchema = new mongoose.Schema({
  title: { type: String, default: "", trim: true },
  videoUrl: { type: String, required: true },
  videoPublicId: { type: String, default: "" },
  /** upload | youtube | url */
  videoType: {
    type: String,
    enum: ["upload", "youtube", "url", ""],
    default: "upload",
  },
  durationMinutes: { type: Number, default: 0 },
  order: { type: Number, default: 0 },
});

/** Lesson learning materials: PDF / PPTX / DOCX */
const documentItemSchema = new mongoose.Schema({
  title: { type: String, default: "", trim: true },
  fileUrl: { type: String, required: true },
  filePublicId: { type: String, default: "" },
  fileType: {
    type: String,
    enum: ["pdf", "pptx", "docx", "ppt", "doc", "file"],
    default: "file",
  },
  mimeType: { type: String, default: "" },
  bytes: { type: Number, default: 0 },
  /** Extracted text for AI chat — stripped from API responses */
  extractedText: { type: String, default: "" },
  hasText: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
});

const lessonSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, default: "" },
  /** Primary video (synced from videos[0] for player compatibility) */
  videoUrl: String,
  videoPublicId: String,
  videoType: {
    type: String,
    enum: ["upload", "youtube", "url", ""],
    default: "",
  },
  /** Multiple videos per lesson — at least one required before publish */
  videos: [videoItemSchema],
  documents: [documentItemSchema],
  durationMinutes: { type: Number, default: 0 },
  order: { type: Number, default: 0 },
  isPreview: { type: Boolean, default: false },
});

const moduleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  order: { type: Number, default: 0 },
  lessons: [lessonSchema],
});

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    shortDescription: { type: String, default: "" },
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    thumbnail: {
      url: String,
      publicId: String,
    },
    price: { type: Number, required: true, min: 0 },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced", "all"],
      default: "all",
    },
    status: {
      type: String,
      enum: ["draft", "review", "published", "archived"],
      default: "draft",
    },
    modules: [moduleSchema],
    tags: [String],
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    studentsCount: { type: Number, default: 0 },
    enrolledUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    searchText: { type: String, default: "" },
    embedding: { type: [Number], default: undefined, select: false },
  },
  { timestamps: true }
);

courseSchema.index({
  title: "text",
  description: "text",
  tags: "text",
  searchText: "text",
});

export default mongoose.model("Course", courseSchema);
