import asyncHandler from "express-async-handler";
import User from "../models/User.js";
import { generateToken } from "../utils/generateToken.js";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const sendAuthResponse = (res, user, statusCode = 200) => {
  const token = generateToken(user._id);

  res.cookie("token", token, cookieOptions);

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      job: user.job || "",
      summary: user.summary || "",
      profileComplete: Boolean(user.profileComplete),
    },
  });
};

function isInstructorProfileComplete(user) {
  return Boolean(
    user?.avatar?.url &&
      user?.name?.trim() &&
      user?.email?.trim() &&
      user?.job?.trim() &&
      user?.summary?.trim(),
  );
}

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error("Please provide name, email, and password");
  }

  if (password.length < 8) {
    res.status(400);
    throw new Error("Password must be at least 8 characters");
  }

  const exists = await User.findOne({ email });
  if (exists) {
    res.status(400);
    throw new Error("User already exists");
  }

  const user = await User.create({
    name,
    email,
    password,
    role: role === "instructor" ? "instructor" : "student",
    profileComplete: role === "instructor" ? false : true,
  });

  sendAuthResponse(res, user, 201);
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Please provide email and password");
  }

  const user = await User.findOne({ email }).select("+password");

  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error("Invalid email or password");
  }

  if (!user.isActive) {
    res.status(403);
    throw new Error("Account is deactivated");
  }

  // Keep profileComplete in sync for older instructor accounts
  if (user.role === "instructor") {
    const complete = isInstructorProfileComplete(user);
    if (user.profileComplete !== complete) {
      user.profileComplete = complete;
      await user.save();
    }
  }

  sendAuthResponse(res, user);
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = asyncHandler(async (req, res) => {
  const user = req.user;
  if (user.role === "instructor") {
    const complete = isInstructorProfileComplete(user);
    if (user.profileComplete !== complete) {
      user.profileComplete = complete;
      await user.save();
    }
  }

  res.json({
    success: true,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      job: user.job || "",
      summary: user.summary || "",
      profileComplete:
        user.role === "instructor"
          ? isInstructorProfileComplete(user)
          : true,
    },
  });
});

// @desc    Update current user profile (seller onboarding / settings)
// @route   PATCH /api/auth/me
// @access  Private
export const updateMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (req.body.name != null) {
    const name = String(req.body.name).trim();
    if (!name) {
      res.status(400);
      throw new Error("Name is required");
    }
    user.name = name;
  }

  // Email is shown but not changed here (autofilled from signup)

  if (req.body.job != null) {
    user.job = String(req.body.job).trim();
  }

  if (req.body.summary != null) {
    const summary = String(req.body.summary).trim();
    if (summary.length > 400) {
      res.status(400);
      throw new Error("Summary must be 400 characters or less");
    }
    user.summary = summary;
  }

  if (req.body.avatar != null) {
    const { url, publicId } = req.body.avatar;
    if (!url) {
      res.status(400);
      throw new Error("Avatar image is required");
    }
    user.avatar = {
      url: String(url),
      publicId: publicId ? String(publicId) : user.avatar?.publicId,
    };
  }

  if (user.role === "instructor") {
    if (!user.avatar?.url) {
      res.status(400);
      throw new Error("Profile image is required");
    }
    if (!user.name?.trim()) {
      res.status(400);
      throw new Error("Name is required");
    }
    if (!user.job?.trim()) {
      res.status(400);
      throw new Error("Job title is required");
    }
    if (!user.summary?.trim()) {
      res.status(400);
      throw new Error("Summary is required");
    }
    user.profileComplete = true;
  }

  await user.save();

  res.json({
    success: true,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      job: user.job || "",
      summary: user.summary || "",
      profileComplete: Boolean(user.profileComplete),
    },
  });
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Public
export const logout = asyncHandler(async (_req, res) => {
  res.cookie("token", "", {
    ...cookieOptions,
    maxAge: 0,
  });

  res.json({ success: true, message: "Logged out successfully" });
});
