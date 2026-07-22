import mongoose from "mongoose";

/** Singleton platform settings — one admin marketplace config */
const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "platform", unique: true },
    stripeConnected: { type: Boolean, default: false },
    platformFeePercent: { type: Number, default: 20, min: 0, max: 100 },
    stripeAccountId: String,
  },
  { timestamps: true }
);

platformSettingsSchema.statics.getSettings = async function () {
  let doc = await this.findOne({ key: "platform" });
  if (!doc) {
    doc = await this.create({
      key: "platform",
      stripeConnected: false,
      platformFeePercent: Number(process.env.PLATFORM_FEE_PERCENT) || 20,
    });
  }
  return doc;
};

export default mongoose.model("PlatformSettings", platformSettingsSchema);
