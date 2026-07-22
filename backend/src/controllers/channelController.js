import asyncHandler from "express-async-handler";
import { Channel, ChannelMessage } from "../models/Channel.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import { ensureChannel } from "./enrollmentController.js";

async function assertChannelAccess(user, courseId) {
  const course = await Course.findById(courseId);
  if (!course) {
    const err = new Error("Course not found");
    err.statusCode = 404;
    throw err;
  }

  const isInstructor = String(course.instructor) === String(user._id);
  const isAdmin = user.role === "admin";
  const enrolled = await Enrollment.findOne({ student: user._id, course: courseId });

  if (!isInstructor && !isAdmin && !enrolled) {
    const err = new Error("Join the course to access this channel");
    err.statusCode = 403;
    throw err;
  }
  return course;
}

export const getCourseChannel = asyncHandler(async (req, res) => {
  const course = await assertChannelAccess(req.user, req.params.courseId);
  const channel = await ensureChannel(course);
  const messages = await ChannelMessage.find({ channel: channel._id })
    .populate("sender", "name role avatar")
    .sort({ createdAt: -1 })
    .limit(100);

  res.json({
    success: true,
    data: { channel, messages: messages.reverse() },
  });
});

export const postMessage = asyncHandler(async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) {
    res.status(400);
    throw new Error("Message body required");
  }

  const course = await assertChannelAccess(req.user, req.params.courseId);
  const channel = await ensureChannel(course);

  const message = await ChannelMessage.create({
    channel: channel._id,
    sender: req.user._id,
    body: body.trim(),
  });

  await message.populate("sender", "name role avatar");
  res.status(201).json({ success: true, data: message });
});
