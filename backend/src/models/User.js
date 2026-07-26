import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false,
    },
    role: {
      type: String,
      enum: ["student", "instructor", "admin"],
      default: "student",
    },
    avatar: {
      url: String,
      publicId: String,
    },
    /** Seller / instructor job title */
    job: {
      type: String,
      trim: true,
      default: "",
    },
    /** Seller detail summary */
    summary: {
      type: String,
      trim: true,
      maxlength: [400, "Summary cannot exceed 400 characters"],
      default: "",
    },
    /** True once instructor completes required onboarding profile */
    profileComplete: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Stripe Connect (instructors receive 80%)
    stripeAccountId: String,
    stripeOnboardingComplete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
