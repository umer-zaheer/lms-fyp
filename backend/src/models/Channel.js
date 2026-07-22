import mongoose from "mongoose";

const channelSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      unique: true,
    },
    name: { type: String, required: true },
  },
  { timestamps: true }
);

const channelMessageSchema = new mongoose.Schema(
  {
    channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

channelMessageSchema.index({ channel: 1, createdAt: -1 });

export const Channel = mongoose.model("Channel", channelSchema);
export const ChannelMessage = mongoose.model("ChannelMessage", channelMessageSchema);
