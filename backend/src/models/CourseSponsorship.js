import mongoose from "mongoose";

/**
 * Seller (instructor) course sponsorship.
 * Methods:
 *  - commission: platform takes base fee + extra commissionPercent on sales
 *  - ppc: pay-per-click — costPerClick deducted from budget on each tracked click
 */
const courseSponsorshipSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    method: {
      type: String,
      enum: ["commission", "ppc"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "paused", "ended", "exhausted"],
      default: "active",
      index: true,
    },
    /** Extra % on top of platform fee when method = commission (5–50) */
    commissionPercent: {
      type: Number,
      min: 0,
      max: 50,
      default: 0,
    },
    /** USD charged per click when method = ppc */
    costPerClick: {
      type: Number,
      min: 0,
      default: 0,
    },
    /** Total PPC budget in USD */
    budget: {
      type: Number,
      min: 0,
      default: 0,
    },
    spent: {
      type: Number,
      min: 0,
      default: 0,
    },
    clicks: {
      type: Number,
      min: 0,
      default: 0,
    },
    impressions: {
      type: Number,
      min: 0,
      default: 0,
    },
    startsAt: {
      type: Date,
      default: Date.now,
    },
    endsAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

courseSponsorshipSchema.index({ course: 1, status: 1 });
courseSponsorshipSchema.index({ status: 1, method: 1, updatedAt: -1 });

/** Active sponsorship eligible for featuring right now */
courseSponsorshipSchema.statics.findActiveForCourses = async function (courseIds) {
  const now = new Date();
  return this.find({
    course: { $in: courseIds },
    status: "active",
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
  });
};

courseSponsorshipSchema.statics.listActiveSponsored = async function (limit = 20) {
  const now = new Date();
  const rows = await this.find({
    status: "active",
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
  })
    .sort({ updatedAt: -1 })
    .limit(Number(limit) || 20)
    .populate({
      path: "course",
      match: { status: "published" },
      populate: [
        { path: "instructor", select: "name email avatar" },
        { path: "category", select: "name slug" },
      ],
    });

  return rows.filter((r) => r.course);
};

export default mongoose.model("CourseSponsorship", courseSponsorshipSchema);
