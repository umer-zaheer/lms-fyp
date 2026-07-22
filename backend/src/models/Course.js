import mongoose from "mongoose";

const lessonSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, default: "" },
  videoUrl: String,
  videoPublicId: String,
  /** upload | youtube | url */
  videoType: {
    type: String,
    enum: ["upload", "youtube", "url", ""],
    default: "",
  },
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
    // RAG: searchable text + embedding vector (OpenRouter embeddings)
    searchText: { type: String, default: "" },
    embedding: { type: [Number], default: undefined, select: false },
  },
  { timestamps: true }
);

courseSchema.index({ title: "text", description: "text", tags: "text", searchText: "text" });

export default mongoose.model("Course", courseSchema);
