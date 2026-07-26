import asyncHandler from "express-async-handler";
import crypto from "crypto";
import LiveSession, {
  createRoomId,
  createShareCode,
} from "../models/LiveSession.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import { throwHttp } from "../utils/helpers.js";
import { generateToken04, getZegoConfig } from "../utils/zegoToken.js";
import {
  emitJoinRequestCreated,
  emitJoinRequestUpdated,
  emitLiveStarted,
} from "../socket.js";

function clientBase() {
  return (process.env.CLIENT_URL || "http://localhost:8080").replace(/\/$/, "");
}

function serializeSession(s, { includeRequests = false } = {}) {
  const course = s.course;
  const instructor = s.instructor;
  const pending = (s.joinRequests || []).filter((r) => r.status === "pending");
  const accepted = (s.joinRequests || []).filter((r) => r.status === "accepted");

  const data = {
    id: s._id,
    title: s.title,
    label: s.label || "",
    type: s.type,
    status: s.status,
    startAt: s.startAt,
    endAt: s.endAt,
    roomId: s.roomId,
    shareCode: s.shareCode,
    shareUrl: `${clientBase()}/live/${s.shareCode}`,
    course: {
      id: course?._id || course,
      title: course?.title || "Course",
      thumbnail: course?.thumbnail?.url || null,
    },
    instructor: {
      id: instructor?._id || instructor,
      name: instructor?.name || "Instructor",
      avatar: instructor?.avatar?.url || null,
    },
    pendingCount: pending.length,
    acceptedCount: accepted.length,
    createdAt: s.createdAt,
  };

  if (includeRequests) {
    data.joinRequests = (s.joinRequests || []).map((r) => ({
      id: r._id,
      name: r.name,
      email: r.email || "",
      audience: r.audience,
      status: r.status,
      userId: r.user?._id || r.user || null,
      guestId: r.guestId || "",
      requestedAt: r.requestedAt,
      respondedAt: r.respondedAt || null,
    }));
  }

  return data;
}

async function assertInstructorOwnsCourse(res, instructorId, courseId) {
  const course = await Course.findById(courseId);
  if (!course) throwHttp(res, 404, "Course not found");
  if (String(course.instructor) !== String(instructorId)) {
    throwHttp(res, 403, "You can only host live sessions for your courses");
  }
  return course;
}

/** List instructor's live sessions */
export const listInstructorSessions = asyncHandler(async (req, res) => {
  const status = String(req.query.status || "all").toLowerCase();
  const filter = { instructor: req.user._id };
  if (status === "upcoming") {
    filter.status = { $in: ["scheduled", "live"] };
    filter.endAt = { $gte: new Date() };
  } else if (status === "live") {
    filter.status = "live";
  } else if (status === "completed" || status === "ended") {
    filter.status = { $in: ["ended", "cancelled"] };
  } else if (status === "scheduled") {
    filter.status = "scheduled";
  }

  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const sessions = await LiveSession.find(filter)
    .populate("course", "title thumbnail")
    .populate("instructor", "name avatar")
    .sort({ startAt: 1 })
    .limit(limit);

  res.json({
    success: true,
    data: sessions.map((s) => serializeSession(s)),
  });
});

/** Student: scheduled/live sessions for enrolled courses */
export const listStudentSessions = asyncHandler(async (req, res) => {
  const enrollments = await Enrollment.find({ student: req.user._id }).select("course");
  const courseIds = enrollments.map((e) => e.course);
  if (!courseIds.length) {
    return res.json({ success: true, data: [] });
  }

  const now = new Date();
  const filter = {
    course: { $in: courseIds },
    status: { $in: ["scheduled", "live"] },
    endAt: { $gte: now },
  };

  const sessions = await LiveSession.find(filter)
    .populate("course", "title thumbnail")
    .populate("instructor", "name avatar")
    .sort({ startAt: 1 })
    .limit(100);

  res.json({
    success: true,
    data: sessions.map((s) => serializeSession(s)),
  });
});

/** Create a scheduled session */
export const createScheduledSession = asyncHandler(async (req, res) => {
  const { title, label, courseId, startAt, endAt } = req.body;
  if (!title?.trim()) throwHttp(res, 400, "Meeting name is required");
  if (!courseId) throwHttp(res, 400, "Course is required");
  if (!startAt || !endAt) throwHttp(res, 400, "Start and end time are required");

  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throwHttp(res, 400, "Invalid date/time");
  }
  if (end <= start) throwHttp(res, 400, "End time must be after start time");

  await assertInstructorOwnsCourse(res, req.user._id, courseId);

  const session = await LiveSession.create({
    title: title.trim(),
    label: (label || "").trim(),
    course: courseId,
    instructor: req.user._id,
    type: "scheduled",
    startAt: start,
    endAt: end,
    roomId: createRoomId("sched"),
    shareCode: createShareCode(),
    status: "scheduled",
  });

  await session.populate("course", "title thumbnail");
  await session.populate("instructor", "name avatar");

  const payload = serializeSession(session);
  if (session.type === "scheduled") {
    emitLiveStarted(String(courseId), payload);
  }

  res.status(201).json({ success: true, data: payload });
});

/** Instant go-live */
export const goLiveInstant = asyncHandler(async (req, res) => {
  const { title, label, courseId, durationMinutes } = req.body;
  if (!courseId) throwHttp(res, 400, "Course is required");

  await assertInstructorOwnsCourse(res, req.user._id, courseId);

  const mins = Math.min(Math.max(Number(durationMinutes) || 60, 15), 240);
  const start = new Date();
  const end = new Date(start.getTime() + mins * 60 * 1000);

  const session = await LiveSession.create({
    title: (title || "Live class").trim(),
    label: (label || "Live Now").trim(),
    course: courseId,
    instructor: req.user._id,
    type: "instant",
    startAt: start,
    endAt: end,
    roomId: createRoomId("instant"),
    shareCode: createShareCode(),
    status: "live",
  });

  await session.populate("course", "title thumbnail");
  await session.populate("instructor", "name avatar");

  const payload = serializeSession(session, { includeRequests: true });
  emitLiveStarted(String(courseId), payload);

  res.status(201).json({ success: true, data: payload });
});

/** Get by id (instructor or enrolled student) */
export const getSessionById = asyncHandler(async (req, res) => {
  const session = await LiveSession.findById(req.params.id)
    .populate("course", "title thumbnail instructor")
    .populate("instructor", "name avatar")
    .populate("joinRequests.user", "name email avatar");

  if (!session) throwHttp(res, 404, "Live session not found");

  const isInstructor =
    String(session.instructor._id || session.instructor) === String(req.user._id);
  const isAdmin = req.user.role === "admin";

  if (!isInstructor && !isAdmin) {
    const enrolled = await Enrollment.findOne({
      student: req.user._id,
      course: session.course._id || session.course,
    });
    if (!enrolled) throwHttp(res, 403, "Not allowed");
  }

  res.json({
    success: true,
    data: serializeSession(session, { includeRequests: isInstructor || isAdmin }),
  });
});

/** Public: get session by share code (limited fields) */
export const getSessionByCode = asyncHandler(async (req, res) => {
  const session = await LiveSession.findOne({ shareCode: req.params.code })
    .populate("course", "title thumbnail")
    .populate("instructor", "name avatar");

  if (!session) throwHttp(res, 404, "Live session not found");

  res.json({
    success: true,
    data: {
      id: session._id,
      title: session.title,
      label: session.label,
      status: session.status,
      type: session.type,
      startAt: session.startAt,
      endAt: session.endAt,
      shareCode: session.shareCode,
      course: {
        id: session.course?._id,
        title: session.course?.title,
      },
      instructor: {
        name: session.instructor?.name,
        avatar: session.instructor?.avatar?.url || null,
      },
    },
  });
});

/** Start a scheduled session */
export const startSession = asyncHandler(async (req, res) => {
  const session = await LiveSession.findById(req.params.id);
  if (!session) throwHttp(res, 404, "Live session not found");
  if (String(session.instructor) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }
  if (session.status === "ended" || session.status === "cancelled") {
    throwHttp(res, 400, "Session already ended");
  }

  session.status = "live";
  if (!session.startAt || session.startAt > new Date()) {
    session.startAt = new Date();
  }
  await session.save();
  await session.populate("course", "title thumbnail");
  await session.populate("instructor", "name avatar");

  res.json({ success: true, data: serializeSession(session, { includeRequests: true }) });
});

/** End session */
export const endSession = asyncHandler(async (req, res) => {
  const session = await LiveSession.findById(req.params.id);
  if (!session) throwHttp(res, 404, "Live session not found");
  if (String(session.instructor) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  session.status = "ended";
  session.endAt = new Date();
  await session.save();
  await session.populate("course", "title thumbnail");
  await session.populate("instructor", "name avatar");

  res.json({ success: true, data: serializeSession(session) });
});

/** Request to join (auth optional for guests) */
export const requestJoin = asyncHandler(async (req, res) => {
  const session = await LiveSession.findById(req.params.id).populate("course", "title");
  if (!session) throwHttp(res, 404, "Live session not found");
  if (session.status === "ended" || session.status === "cancelled") {
    throwHttp(res, 400, "This session has ended");
  }

  const { name, guestId } = req.body;
  const user = req.user || null;

  let displayName = (name || user?.name || "").trim();
  if (!displayName) throwHttp(res, 400, "Name is required");

  let audience = "external";
  let userId = null;
  let gid = guestId || "";

  if (user) {
    userId = user._id;
    displayName = user.name || displayName;
    const enrolled = await Enrollment.findOne({
      student: user._id,
      course: session.course._id || session.course,
    });
    audience = enrolled ? "internal" : "external";

    // Note: even the course instructor must request when using the public /live link
    // so testing from another tab still creates a visible pending request.
  } else if (!gid) {
    gid = `guest_${crypto.randomBytes(8).toString("hex")}`;
  }

  // Find any prior request for this person (including rejected/accepted)
  const existing = session.joinRequests.find((r) => {
    if (userId && r.user && String(r.user) === String(userId)) return true;
    if (!userId && gid && r.guestId && r.guestId === gid) return true;
    return false;
  });

  // Every "Request to join" click requires instructor approval again
  if (existing) {
    existing.name = displayName;
    existing.email = user?.email || existing.email || "";
    existing.audience = audience;
    existing.status = "pending";
    existing.requestedAt = new Date();
    existing.respondedAt = undefined;
    if (gid) existing.guestId = gid;
    if (userId) existing.user = userId;
    await session.save();

    emitJoinRequestCreated(String(session._id), existing, session.instructor);

    return res.status(200).json({
      success: true,
      data: {
        requestId: existing._id,
        status: "pending",
        audience: existing.audience,
        guestId: gid || null,
        isHost: false,
      },
    });
  }

  const reqDoc = {
    user: userId,
    guestId: gid,
    name: displayName,
    email: user?.email || "",
    audience,
    status: "pending",
    requestedAt: new Date(),
  };
  session.joinRequests.push(reqDoc);
  await session.save();

  const created = session.joinRequests[session.joinRequests.length - 1];
  emitJoinRequestCreated(String(session._id), created, session.instructor);

  res.status(201).json({
    success: true,
    data: {
      requestId: created._id,
      status: created.status,
      audience: created.audience,
      guestId: gid || null,
      isHost: false,
    },
  });
});

/** Poll join request status */
export const getJoinRequestStatus = asyncHandler(async (req, res) => {
  const session = await LiveSession.findById(req.params.id);
  if (!session) throwHttp(res, 404, "Live session not found");

  const request = session.joinRequests.id(req.params.requestId);
  if (!request) throwHttp(res, 404, "Join request not found");

  res.json({
    success: true,
    data: {
      requestId: request._id,
      status: request.status,
      audience: request.audience,
      name: request.name,
    },
  });
});

/** Instructor: list join requests */
export const listJoinRequests = asyncHandler(async (req, res) => {
  const session = await LiveSession.findById(req.params.id).populate(
    "joinRequests.user",
    "name email avatar",
  );
  if (!session) throwHttp(res, 404, "Live session not found");
  if (String(session.instructor) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  res.json({
    success: true,
    data: serializeSession(session, { includeRequests: true }).joinRequests,
  });
});

/** Accept or reject join request */
export const respondJoinRequest = asyncHandler(async (req, res) => {
  const { action } = req.body; // accept | reject
  if (!["accept", "reject"].includes(action)) {
    throwHttp(res, 400, "action must be accept or reject");
  }

  const session = await LiveSession.findById(req.params.id);
  if (!session) throwHttp(res, 404, "Live session not found");
  if (String(session.instructor) !== String(req.user._id) && req.user.role !== "admin") {
    throwHttp(res, 403, "Not allowed");
  }

  const request = session.joinRequests.id(req.params.requestId);
  if (!request) throwHttp(res, 404, "Join request not found");

  request.status = action === "accept" ? "accepted" : "rejected";
  request.respondedAt = new Date();
  await session.save();

  emitJoinRequestUpdated(String(session._id), request, session.instructor);

  res.json({
    success: true,
    data: {
      id: request._id,
      status: request.status,
      audience: request.audience,
      name: request.name,
    },
  });
});

/**
 * Issue Zego kit credentials.
 * Host always allowed. Participants need accepted join request (or instructor).
 */
export const getZegoCredentials = asyncHandler(async (req, res) => {
  const session = await LiveSession.findById(req.params.id);
  if (!session) throwHttp(res, 404, "Live session not found");
  if (session.status === "ended" || session.status === "cancelled") {
    throwHttp(res, 400, "Session has ended");
  }

  const { appId, serverSecret } = getZegoConfig();
  if (!appId || !serverSecret) {
    throwHttp(res, 500, "Zego is not configured on the server");
  }

  const { requestId, guestId, guestName } = req.body || {};
  const user = req.user || null;

  let role = "audience";
  let userId = "";
  let userName = "";

  const isHost =
    user && String(session.instructor) === String(user._id);

  if (isHost) {
    role = "host";
    userId = String(user._id);
    userName = user.name || "Instructor";
  } else {
    let request = null;
    if (requestId) {
      request = session.joinRequests.id(requestId);
    } else if (user) {
      request = session.joinRequests.find(
        (r) => r.user && String(r.user) === String(user._id) && r.status === "accepted",
      );
    } else if (guestId) {
      request = session.joinRequests.find(
        (r) => r.guestId === guestId && r.status === "accepted",
      );
    }

    if (!request || request.status !== "accepted") {
      throwHttp(res, 403, "Waiting for instructor approval to join");
    }

    userId = user
      ? String(user._id)
      : request.guestId || `guest_${request._id}`;
    userName = request.name || guestName || user?.name || "Guest";
    role = "audience";
  }

  // Ensure Zego userId is alphanumeric-ish
  const zegoUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || `u_${Date.now()}`;

  const token = generateToken04(appId, zegoUserId, serverSecret, 7200, "");

  res.json({
    success: true,
    data: {
      appId,
      token,
      roomId: session.roomId,
      userId: zegoUserId,
      userName,
      role,
      shareUrl: `${clientBase()}/live/${session.shareCode}`,
      title: session.title,
    },
  });
});
