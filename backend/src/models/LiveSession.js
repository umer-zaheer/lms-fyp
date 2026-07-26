import mongoose from "mongoose";
import crypto from "crypto";

const joinRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    guestId: {
      type: String,
      trim: true,
      default: "",
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      trim: true,
      default: "",
    },
    /** internal = enrolled buyer; external = outsider / guest */
    audience: {
      type: String,
      enum: ["internal", "external"],
      default: "external",
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    respondedAt: {
      type: Date,
    },
  },
  { _id: true },
);

const liveSessionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    label: {
      type: String,
      trim: true,
      maxlength: 60,
      default: "",
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["scheduled", "instant"],
      default: "scheduled",
    },
    startAt: {
      type: Date,
      required: true,
    },
    endAt: {
      type: Date,
      required: true,
    },
    roomId: {
      type: String,
      required: true,
      unique: true,
    },
    shareCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "live", "ended", "cancelled"],
      default: "scheduled",
    },
    joinRequests: [joinRequestSchema],
  },
  { timestamps: true },
);

liveSessionSchema.index({ instructor: 1, startAt: -1 });
liveSessionSchema.index({ course: 1, startAt: -1 });
liveSessionSchema.index({ status: 1, startAt: 1 });

export function createShareCode() {
  return crypto.randomBytes(5).toString("hex");
}

export function createRoomId(prefix = "live") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

export default mongoose.model("LiveSession", liveSessionSchema);
