import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Payment from "../models/Payment.js";
import Enrollment from "../models/Enrollment.js";
import Certificate from "../models/Certificate.js";
import Earning from "../models/Earning.js";
import { throwHttp } from "../utils/helpers.js";
import { getDateParts, lastNMonths, monthLabel } from "../utils/dateParts.js";
import { recordPaidPurchase } from "../utils/recordPurchase.js";

export const listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.q) {
    filter.$or = [
      { name: new RegExp(req.query.q, "i") },
      { email: new RegExp(req.query.q, "i") },
    ];
  }
  const data = await User.find(filter)
    .select("-password")
    .sort({ createdAt: -1 });
  res.json({ success: true, data });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throwHttp(res, 404, "User not found");

  // Keep single admin: cannot demote last admin or create second admin casually
  if (req.body.role === "admin" && user.role !== "admin") {
    const adminCount = await User.countDocuments({ role: "admin" });
    if (adminCount >= 1) throwHttp(res, 400, "Only one admin is allowed");
  }

  if (req.body.role && user.role === "admin" && req.body.role !== "admin") {
    throwHttp(res, 400, "Cannot demote the platform admin");
  }

  if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
  if (req.body.role && ["student", "instructor"].includes(req.body.role)) {
    user.role = req.body.role;
  }
  await user.save();
  res.json({ success: true, data: user });
});

export const listPayments = asyncHandler(async (_req, res) => {
  const data = await Payment.find()
    .populate("student", "name email")
    .populate("instructor", "name email")
    .populate("course", "title")
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ success: true, data });
});

export const adminStats = asyncHandler(async (_req, res) => {
  const [students, instructors, courses, revenueAgg, enrollments] =
    await Promise.all([
      User.countDocuments({ role: "student" }),
      User.countDocuments({ role: "instructor" }),
      Course.countDocuments(),
      Payment.aggregate([
        { $match: { status: "paid" } },
        {
          $group: {
            _id: null,
            total: { $sum: "$amountTotal" },
            platform: { $sum: "$platformFee" },
          },
        },
      ]),
      Enrollment.countDocuments(),
    ]);

  res.json({
    success: true,
    data: {
      totalStudents: students,
      totalInstructors: instructors,
      totalCourses: courses,
      totalEnrollments: enrollments,
      totalRevenue: revenueAgg[0]?.total || 0,
      platformRevenue: revenueAgg[0]?.platform || 0,
    },
  });
});

export const myCertificates = asyncHandler(async (req, res) => {
  const data = await Certificate.find({ student: req.user._id })
    .populate("course", "title thumbnail")
    .sort({ issuedAt: -1 });
  res.json({ success: true, data });
});

export const instructorStudents = asyncHandler(async (req, res) => {
  const courses = await Course.find({ instructor: req.user._id }).select(
    "_id title enrolledUserIds studentsCount",
  );
  const ids = courses.map((c) => c._id);
  const data = await Enrollment.find({ course: { $in: ids } })
    .populate("student", "name email avatar")
    .populate("course", "title")
    .sort({ updatedAt: -1 });

  // Keep enrolledUserIds in sync with real enrollments (repair missing ids)
  const byCourse = new Map();
  for (const e of data) {
    const cid = String(e.course?._id || e.course);
    if (!byCourse.has(cid)) byCourse.set(cid, []);
    if (e.student?._id || e.student) {
      byCourse.get(cid).push(e.student._id || e.student);
    }
  }
  await Promise.all(
    courses.map(async (course) => {
      const studentIds = byCourse.get(String(course._id)) || [];
      if (!studentIds.length) return;
      const existing = new Set((course.enrolledUserIds || []).map(String));
      const missing = studentIds.filter((id) => !existing.has(String(id)));
      if (missing.length || (course.studentsCount || 0) !== studentIds.length) {
        await Course.findByIdAndUpdate(course._id, {
          $addToSet: { enrolledUserIds: { $each: studentIds } },
          $set: { studentsCount: studentIds.length },
        });
      }
    }),
  );

  res.json({ success: true, data });
});

export const instructorEarnings = asyncHandler(async (req, res) => {
  const instructorId = req.user._id;
  await ensureEarningsBackfill(instructorId);

  const payments = await Payment.find({
    instructor: instructorId,
  })
    .populate("course", "title")
    .populate("student", "name")
    .sort({ purchasedAt: -1, createdAt: -1 });

  const now = new Date();
  const ytdStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let total = 0;
  let paidYtd = 0;
  let monthSales = 0;
  let available = 0;

  const paidPayments = [];
  const recentSales = [];

  for (const p of payments) {
    const amount = Number(p.instructorAmount) || 0;
    const when = p.purchasedAt || p.updatedAt || p.createdAt || new Date();
    const statusLabel =
      p.status === "paid"
        ? "Paid"
        : p.status === "refunded"
          ? "Refunded"
          : "Pending";

    if (p.status === "paid") {
      total += amount;
      paidPayments.push(p);
      if (when >= ytdStart) paidYtd += amount;
      if (when >= monthStart) monthSales += amount;
    } else if (p.status === "pending") {
      available += amount;
    }

    if (recentSales.length < 12) {
      recentSales.push({
        id: String(p._id),
        student: p.student?.name || "Student",
        course: p.course?.title || "Course",
        amount,
        amountTotal: p.amountTotal || 0,
        date: when.toISOString().slice(0, 10),
        status: statusLabel,
      });
    }
  }

  const months = lastNMonths(12);
  const first = months[0];
  const rangeStart = new Date(first.year, first.month - 1, 1);

  const earningAgg = await Earning.aggregate([
    {
      $match: {
        instructor: new mongoose.Types.ObjectId(String(instructorId)),
        purchasedAt: { $gte: rangeStart },
      },
    },
    {
      $group: {
        _id: { year: "$year", month: "$month" },
        earnings: { $sum: "$amount" },
        sales: { $sum: 1 },
      },
    },
  ]);

  const earnMap = new Map(
    earningAgg.map((r) => [`${r._id.year}-${r._id.month}`, r]),
  );

  const earningsTrend = months.map((m) => {
    const key = `${m.year}-${m.month}`;
    const row = earnMap.get(key);
    const earnings = Math.round((row?.earnings || 0) * 100) / 100;
    // Payouts mirror settled earnings (destination / recorded paid share)
    return {
      month: m.shortLabel,
      label: m.label,
      year: m.year,
      monthNum: m.month,
      earnings,
      payouts: earnings,
      sales: row?.sales || 0,
    };
  });

  // Monthly payout history from paid payments
  const payoutMap = new Map();
  for (const p of paidPayments) {
    const when = p.purchasedAt || p.updatedAt || p.createdAt || new Date();
    const y = when.getFullYear();
    const mo = when.getMonth() + 1;
    const key = `${y}-${mo}`;
    if (!payoutMap.has(key)) {
      payoutMap.set(key, {
        year: y,
        month: mo,
        amount: 0,
        count: 0,
        lastDate: when,
      });
    }
    const row = payoutMap.get(key);
    row.amount += Number(p.instructorAmount) || 0;
    row.count += 1;
    if (when > row.lastDate) row.lastDate = when;
  }

  const payoutHistory = [...payoutMap.values()]
    .sort((a, b) => b.year - a.year || b.month - a.month)
    .slice(0, 12)
    .map((row, idx) => ({
      id: `PO-${row.year}${String(row.month).padStart(2, "0")}-${idx + 1}`,
      period: `${monthLabel(row.month)} ${row.year}`,
      method: "Stripe Connect",
      date: row.lastDate.toISOString().slice(0, 10),
      amount: Math.round(row.amount * 100) / 100,
      status: "Paid",
      sales: row.count,
    }));

  // Pending balance as a payout row when > 0
  if (available > 0) {
    payoutHistory.unshift({
      id: "PO-PENDING",
      period: "Pending balance",
      method: "Awaiting clearance",
      date: now.toISOString().slice(0, 10),
      amount: Math.round(available * 100) / 100,
      status: "Pending",
      sales: payments.filter((p) => p.status === "pending").length,
    });
  }

  res.json({
    success: true,
    data: {
      total: Math.round(total * 100) / 100,
      available: Math.round(available * 100) / 100,
      paidYtd: Math.round(paidYtd * 100) / 100,
      monthSales: Math.round(monthSales * 100) / 100,
      earningsTrend,
      payoutHistory,
      recentSales,
      payments: payments.filter((p) => p.status === "paid"),
    },
  });
});

/** Seller dashboard KPIs: students, active courses, lifetime earnings, avg rating */
export const instructorStats = asyncHandler(async (req, res) => {
  const instructorId = req.user._id;
  const courses = await Course.find({ instructor: instructorId }).select(
    "price status rating ratingCount enrolledUserIds studentsCount",
  );

  // Backfill enrolledUserIds from Enrollment whenever lists are incomplete
  const needsBackfill = courses.filter((c) => {
    const listed = c.enrolledUserIds?.length || 0;
    const counted = c.studentsCount || 0;
    return listed < counted || (counted > 0 && listed === 0);
  });
  if (needsBackfill.length) {
    await Promise.all(
      needsBackfill.map(async (course) => {
        const enrollments = await Enrollment.find({ course: course._id }).select(
          "student",
        );
        const ids = enrollments.map((e) => e.student);
        course.enrolledUserIds = ids;
        course.studentsCount = ids.length;
        await course.save();
      }),
    );
  }

  const uniqueStudents = new Set();
  let ratingSum = 0;
  let ratingCourses = 0;
  let activeCourses = 0;
  const courseIds = [];

  for (const course of courses) {
    courseIds.push(course._id);
    const buyerIds = (course.enrolledUserIds || []).map(String);
    for (const id of buyerIds) uniqueStudents.add(id);
    if (course.status === "published") activeCourses += 1;
    if ((course.ratingCount || 0) > 0) {
      ratingSum += Number(course.rating) || 0;
      ratingCourses += 1;
    }
  }

  const [paidAgg, enrollStats] = await Promise.all([
    Payment.aggregate([
      {
        $match: {
          instructor: new mongoose.Types.ObjectId(String(instructorId)),
          status: "paid",
        },
      },
      { $group: { _id: null, total: { $sum: "$instructorAmount" } } },
    ]),
    Enrollment.aggregate([
      { $match: { course: { $in: courseIds } } },
      {
        $group: {
          _id: null,
          avgProgress: { $avg: "$progress" },
          completed: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $gte: ["$progress", 100] },
                    { $ne: ["$completedAt", null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          total: { $sum: 1 },
        },
      },
    ]),
  ]);

  const totalEarnings = Math.round((paidAgg[0]?.total || 0) * 100) / 100;
  const totalStudents =
    uniqueStudents.size ||
    courses.reduce((s, c) => s + (c.studentsCount || 0), 0);
  const avgRating =
    ratingCourses > 0 ? Math.round((ratingSum / ratingCourses) * 100) / 100 : 0;

  const es = enrollStats[0];
  const completionRate =
    es && es.total > 0
      ? Math.round((es.completed / es.total) * 1000) / 10
      : Math.round((es?.avgProgress || 0) * 10) / 10;

  res.json({
    success: true,
    data: {
      totalStudents,
      activeCourses,
      totalEarnings,
      avgRating,
      completionRate,
    },
  });
});

/**
 * Backfill payment date parts + Earning rows from existing paid payments.
 * Safe to call repeatedly (upserts).
 */
async function ensureEarningsBackfill(instructorId) {
  const paid = await Payment.find({
    instructor: instructorId,
    status: "paid",
  });

  for (const payment of paid) {
    if (!payment.year || !payment.month || !payment.day || !payment.purchasedAt) {
      const when = payment.purchasedAt || payment.updatedAt || payment.createdAt || new Date();
      await recordPaidPurchase({ payment, when });
    } else {
      // Ensure Earning row exists
      const exists = await Earning.findOne({
        student: payment.student,
        course: payment.course,
      });
      if (!exists) {
        await recordPaidPurchase({
          payment,
          when: payment.purchasedAt,
        });
      }
    }
  }

  // Backfill enrollment year/month/day from createdAt when missing
  const courses = await Course.find({ instructor: instructorId }).select("_id");
  const courseIds = courses.map((c) => c._id);
  const enrollments = await Enrollment.find({
    course: { $in: courseIds },
    $or: [{ year: { $exists: false } }, { year: null }, { month: { $exists: false } }, { month: null }],
  });

  for (const e of enrollments) {
    const when = e.enrolledAt || e.createdAt || new Date();
    const parts = getDateParts(when);
    e.enrolledAt = parts.at;
    e.year = parts.year;
    e.month = parts.month;
    e.day = parts.day;
    await e.save();
  }
}

/** Monthly earnings + enrollment trends for seller dashboard charts */
export const instructorAnalytics = asyncHandler(async (req, res) => {
  const instructorId = new mongoose.Types.ObjectId(String(req.user._id));
  await ensureEarningsBackfill(req.user._id);

  const months = lastNMonths(12);
  const first = months[0];
  const rangeStart = new Date(first.year, first.month - 1, 1);

  const courses = await Course.find({ instructor: instructorId }).select("_id");
  const courseIds = courses.map((c) => c._id);

  const [earningAgg, enrollmentAgg] = await Promise.all([
    Earning.aggregate([
      {
        $match: {
          instructor: instructorId,
          purchasedAt: { $gte: rangeStart },
        },
      },
      {
        $group: {
          _id: { year: "$year", month: "$month" },
          earnings: { $sum: "$amount" },
          sales: { $sum: 1 },
        },
      },
    ]),
    Enrollment.aggregate([
      {
        $match: {
          course: { $in: courseIds },
          $or: [
            { enrolledAt: { $gte: rangeStart } },
            { createdAt: { $gte: rangeStart } },
          ],
        },
      },
      {
        $addFields: {
          _year: {
            $ifNull: [
              "$year",
              { $year: { $ifNull: ["$enrolledAt", "$createdAt"] } },
            ],
          },
          _month: {
            $ifNull: [
              "$month",
              { $month: { $ifNull: ["$enrolledAt", "$createdAt"] } },
            ],
          },
        },
      },
      {
        $group: {
          _id: { year: "$_year", month: "$_month" },
          enrollments: { $sum: 1 },
        },
      },
    ]),
  ]);

  const earnMap = new Map(
    earningAgg.map((r) => [`${r._id.year}-${r._id.month}`, r]),
  );
  const enrollMap = new Map(
    enrollmentAgg.map((r) => [`${r._id.year}-${r._id.month}`, r]),
  );

  const earningsTrend = months.map((m) => {
    const key = `${m.year}-${m.month}`;
    const row = earnMap.get(key);
    return {
      month: m.shortLabel,
      label: m.label,
      year: m.year,
      monthNum: m.month,
      earnings: Math.round((row?.earnings || 0) * 100) / 100,
      sales: row?.sales || 0,
    };
  });

  const enrollmentTrend = months.map((m) => {
    const key = `${m.year}-${m.month}`;
    const row = enrollMap.get(key);
    return {
      month: m.shortLabel,
      label: m.label,
      year: m.year,
      monthNum: m.month,
      enrollments: row?.enrollments || 0,
    };
  });

  // Top courses by sales count (logged-in seller only)
  const salesByCourse = await Earning.aggregate([
    { $match: { instructor: instructorId } },
    {
      $group: {
        _id: "$course",
        sales: { $sum: 1 },
        earnings: { $sum: "$amount" },
      },
    },
  ]);
  const salesMap = new Map(
    salesByCourse.map((r) => [String(r._id), r]),
  );

  const sellerCourses = await Course.find({ instructor: instructorId })
    .select("title thumbnail rating studentsCount enrolledUserIds status price")
    .lean();

  const topCourses = sellerCourses
    .map((c) => {
      const fromEarn = salesMap.get(String(c._id));
      const sales =
        fromEarn?.sales ||
        (c.enrolledUserIds?.length || 0) ||
        c.studentsCount ||
        0;
      return {
        id: c._id,
        title: c.title,
        thumbnail: c.thumbnail?.url || null,
        students: c.enrolledUserIds?.length || c.studentsCount || 0,
        sales,
        rating: c.rating || 0,
        status: c.status,
        price: c.price || 0,
      };
    })
    .sort((a, b) => b.sales - a.sales || b.students - a.students)
    .slice(0, 4);

  // Recent sales for this seller only
  const recentPayments = await Payment.find({
    instructor: instructorId,
    status: { $in: ["paid", "refunded", "pending"] },
  })
    .populate("student", "name")
    .populate("course", "title")
    .sort({ purchasedAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(8)
    .lean();

  const recentSales = recentPayments.map((p) => {
    const when = p.purchasedAt || p.updatedAt || p.createdAt;
    const d = when ? new Date(when) : null;
    const statusLabel =
      p.status === "paid"
        ? "Paid"
        : p.status === "refunded"
          ? "Refunded"
          : p.status === "pending"
            ? "Pending"
            : String(p.status || "Paid");

    return {
      id: p._id,
      student: p.student?.name || "Student",
      course: p.course?.title || "Course",
      amount: p.instructorAmount ?? p.amountTotal ?? 0,
      amountTotal: p.amountTotal || 0,
      date: d ? d.toISOString().slice(0, 10) : null,
      year: p.year || (d ? d.getFullYear() : null),
      month: p.month || (d ? d.getMonth() + 1 : null),
      day: p.day || (d ? d.getDate() : null),
      status: statusLabel,
    };
  });

  // Course performance with completion %
  const progressByCourse = await Enrollment.aggregate([
    { $match: { course: { $in: courseIds } } },
    {
      $group: {
        _id: "$course",
        students: { $sum: 1 },
        avgProgress: { $avg: "$progress" },
        completed: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $gte: ["$progress", 100] },
                  { $ne: ["$completedAt", null] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const progressMap = new Map(
    progressByCourse.map((r) => [String(r._id), r]),
  );

  const coursePerformance = sellerCourses
    .map((c) => {
      const prog = progressMap.get(String(c._id));
      const students =
        prog?.students ||
        c.enrolledUserIds?.length ||
        c.studentsCount ||
        0;
      const completion =
        prog && prog.students > 0
          ? Math.round((prog.completed / prog.students) * 100)
          : Math.round(prog?.avgProgress || 0);
      return {
        id: String(c._id),
        course: c.title,
        students,
        completion,
        rating: Math.round((c.rating || 0) * 100) / 100,
      };
    })
    .sort((a, b) => b.students - a.students)
    .slice(0, 6);

  const overallCompletion =
    coursePerformance.length > 0
      ? Math.round(
          coursePerformance.reduce((s, c) => s + c.completion, 0) /
            coursePerformance.length,
        )
      : 0;

  // Weekly engagement (last 7 days) from enrollment activity
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weeklyBuckets = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return {
      key: d.toISOString().slice(0, 10),
      day: dayNames[d.getDay()],
      views: 0,
      completions: 0,
    };
  });
  const weekMap = new Map(weeklyBuckets.map((b) => [b.key, b]));

  const weekEnrollments = await Enrollment.find({
    course: { $in: courseIds },
    $or: [
      { updatedAt: { $gte: weekStart } },
      { enrolledAt: { $gte: weekStart } },
      { completedAt: { $gte: weekStart } },
    ],
  })
    .select("progress completedAt enrolledAt updatedAt createdAt")
    .lean();

  for (const e of weekEnrollments) {
    const viewWhen = e.updatedAt || e.enrolledAt || e.createdAt;
    if (viewWhen && viewWhen >= weekStart) {
      const key = new Date(viewWhen).toISOString().slice(0, 10);
      const bucket = weekMap.get(key);
      if (bucket) bucket.views += 1;
    }
    if (e.completedAt && e.completedAt >= weekStart) {
      const key = new Date(e.completedAt).toISOString().slice(0, 10);
      const bucket = weekMap.get(key);
      if (bucket) bucket.completions += 1;
    } else if ((e.progress || 0) >= 100 && viewWhen && viewWhen >= weekStart) {
      const key = new Date(viewWhen).toISOString().slice(0, 10);
      const bucket = weekMap.get(key);
      if (bucket) bucket.completions += 1;
    }
  }

  const weeklyEngagement = weeklyBuckets.map(({ day, views, completions }) => ({
    day,
    views,
    completions,
  }));

  // KPI trends vs previous 30 days
  const prevStart = new Date();
  prevStart.setDate(prevStart.getDate() - 60);
  const mid = new Date();
  mid.setDate(mid.getDate() - 30);

  const [enrollRecent, enrollPrev, earnRecent, earnPrev] = await Promise.all([
    Enrollment.countDocuments({
      course: { $in: courseIds },
      $or: [{ enrolledAt: { $gte: mid } }, { createdAt: { $gte: mid } }],
    }),
    Enrollment.countDocuments({
      course: { $in: courseIds },
      $or: [
        { enrolledAt: { $gte: prevStart, $lt: mid } },
        { createdAt: { $gte: prevStart, $lt: mid } },
      ],
    }),
    Earning.aggregate([
      {
        $match: {
          instructor: instructorId,
          purchasedAt: { $gte: mid },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Earning.aggregate([
      {
        $match: {
          instructor: instructorId,
          purchasedAt: { $gte: prevStart, $lt: mid },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const pctChange = (cur, prev) => {
    if (!prev && !cur) return "0%";
    if (!prev) return "+100%";
    const diff = Math.round(((cur - prev) / prev) * 100);
    return `${diff >= 0 ? "+" : ""}${diff}%`;
  };

  // Insights from real data
  const peakDay = [...weeklyEngagement].sort(
    (a, b) => b.views - a.views || b.completions - a.completions,
  )[0];
  const bestCourse = [...coursePerformance].sort(
    (a, b) => b.completion - a.completion || b.students - a.students,
  )[0];
  const weakCourse = [...coursePerformance]
    .filter((c) => c.students > 0)
    .sort((a, b) => a.completion - b.completion || b.students - a.students)[0];

  const insights = [];
  if (peakDay && peakDay.views > 0) {
    insights.push({
      title: `${peakDay.day} peak`,
      body: `Learner activity peaks on ${peakDay.day}s (${peakDay.views} sessions this week) — schedule live sessions then for max attendance.`,
    });
  } else {
    insights.push({
      title: "Build engagement",
      body: "Not enough recent lesson activity yet. Encourage students to start their first module this week.",
    });
  }
  if (bestCourse && bestCourse.students > 0) {
    insights.push({
      title: `${bestCourse.course.slice(0, 40)}${bestCourse.course.length > 40 ? "…" : ""} leads completion`,
      body: `This course is at ${bestCourse.completion}% completion with ${bestCourse.students} students — reuse its module length in new courses.`,
    });
  } else {
    insights.push({
      title: "Track completion",
      body: "Publish a course and get enrollments to unlock completion insights.",
    });
  }
  if (weakCourse && weakCourse.id !== bestCourse?.id && weakCourse.students > 0) {
    insights.push({
      title: `${weakCourse.course.slice(0, 32)}${weakCourse.course.length > 32 ? "…" : ""} opportunity`,
      body: `${weakCourse.course} sits at ${weakCourse.completion}% completion. Add mid-course checkpoints to lift finish rates.`,
    });
  } else {
    const lastEarn = earningsTrend[earningsTrend.length - 1]?.earnings || 0;
    insights.push({
      title: "Revenue pulse",
      body:
        lastEarn > 0
          ? `You earned $${lastEarn.toFixed(0)} this month from course sales. Keep promoting your top performers.`
          : "No sales this month yet — feature a course via Sponsor Course or share your live session link.",
    });
  }

  res.json({
    success: true,
    data: {
      earningsTrend,
      enrollmentTrend,
      topCourses,
      recentSales,
      weeklyEngagement,
      coursePerformance,
      insights,
      kpis: {
        totalStudents: {
          value: (() => {
            const ids = new Set();
            for (const c of sellerCourses) {
              for (const id of c.enrolledUserIds || []) ids.add(String(id));
            }
            return (
              ids.size ||
              sellerCourses.reduce(
                (s, c) => s + (c.studentsCount || 0),
                0,
              )
            );
          })(),
          trend: pctChange(enrollRecent, enrollPrev),
        },
        avgRating: {
          value:
            sellerCourses.filter((c) => (c.rating || 0) > 0).length > 0
              ? Math.round(
                  (sellerCourses.reduce((s, c) => s + (c.rating || 0), 0) /
                    sellerCourses.filter((c) => (c.rating || 0) > 0).length) *
                    100,
                ) / 100
              : 0,
          trend: "+0%",
        },
        completionRate: {
          value: overallCompletion,
          trend: pctChange(enrollRecent, enrollPrev),
        },
        activeCourses: {
          value: sellerCourses.filter((c) => c.status === "published").length,
          trend:
            sellerCourses.filter((c) => c.status === "published").length > 0
              ? `+${sellerCourses.filter((c) => c.status === "published").length}`
              : "0",
        },
        monthlyEarnings: {
          value: Math.round((earnRecent[0]?.total || 0) * 100) / 100,
          trend: pctChange(earnRecent[0]?.total || 0, earnPrev[0]?.total || 0),
        },
      },
    },
  });
});

/** Top courses by sales for the logged-in seller */
export const instructorTopCourses = asyncHandler(async (req, res) => {
  const instructorId = new mongoose.Types.ObjectId(String(req.user._id));
  await ensureEarningsBackfill(req.user._id);

  const salesByCourse = await Earning.aggregate([
    { $match: { instructor: instructorId } },
    {
      $group: {
        _id: "$course",
        sales: { $sum: 1 },
      },
    },
  ]);
  const salesMap = new Map(
    salesByCourse.map((r) => [String(r._id), r.sales]),
  );

  const courses = await Course.find({ instructor: instructorId })
    .select("title thumbnail rating studentsCount enrolledUserIds status price")
    .lean();

  const data = courses
    .map((c) => {
      const sales =
        salesMap.get(String(c._id)) ||
        c.enrolledUserIds?.length ||
        c.studentsCount ||
        0;
      return {
        id: c._id,
        title: c.title,
        thumbnail: c.thumbnail?.url || null,
        students: c.enrolledUserIds?.length || c.studentsCount || 0,
        sales,
        rating: c.rating || 0,
        status: c.status,
        price: c.price || 0,
      };
    })
    .sort((a, b) => b.sales - a.sales || b.students - a.students)
    .slice(0, Number(req.query.limit) || 4);

  res.json({ success: true, data });
});

/** Recent sales for the logged-in seller only */
export const instructorRecentSales = asyncHandler(async (req, res) => {
  const instructorId = req.user._id;
  await ensureEarningsBackfill(instructorId);

  const limit = Math.min(Number(req.query.limit) || 8, 50);
  const payments = await Payment.find({
    instructor: instructorId,
    status: { $in: ["paid", "refunded", "pending"] },
  })
    .populate("student", "name")
    .populate("course", "title")
    .sort({ purchasedAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  const data = payments.map((p) => {
    const when = p.purchasedAt || p.updatedAt || p.createdAt;
    const d = when ? new Date(when) : null;
    const statusLabel =
      p.status === "paid"
        ? "Paid"
        : p.status === "refunded"
          ? "Refunded"
          : p.status === "pending"
            ? "Pending"
            : String(p.status || "Paid");

    return {
      id: p._id,
      student: p.student?.name || "Student",
      course: p.course?.title || "Course",
      amount: p.instructorAmount ?? p.amountTotal ?? 0,
      amountTotal: p.amountTotal || 0,
      date: d ? d.toISOString().slice(0, 10) : null,
      year: p.year || (d ? d.getFullYear() : null),
      month: p.month || (d ? d.getMonth() + 1 : null),
      day: p.day || (d ? d.getDate() : null),
      status: statusLabel,
    };
  });

  res.json({ success: true, data });
});
