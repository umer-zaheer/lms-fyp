import asyncHandler from "express-async-handler";
import Course from "../models/Course.js";
import CourseSponsorship from "../models/CourseSponsorship.js";
import SponsorPayment from "../models/SponsorPayment.js";
import { throwHttp } from "../utils/helpers.js";
import {
  getActiveSponsoredRows,
  isSponsorshipLive,
  mergeSponsoredFirst,
} from "../utils/sponsor.js";
import {
  createSponsorCheckout,
  fulfillSponsorPayment,
} from "../utils/sponsorCheckout.js";
import { assertStripeConfigured } from "../utils/stripe.js";

function serializeSponsorship(row) {
  const course =
    row.course && typeof row.course === "object" && row.course._id
      ? {
          id: String(row.course._id),
          title: row.course.title,
          status: row.course.status,
          thumbnail: row.course.thumbnail?.url || null,
          price: row.course.price,
          studentsCount: row.course.studentsCount,
          rating: row.course.rating,
        }
      : { id: String(row.course) };

  return {
    id: String(row._id),
    method: row.method,
    status: row.status,
    commissionPercent: row.commissionPercent,
    costPerClick: row.costPerClick,
    budget: row.budget,
    spent: row.spent,
    clicks: row.clicks,
    impressions: row.impressions,
    remainingBudget: Math.max(0, Number(row.budget) - Number(row.spent)),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    live: isSponsorshipLive(row),
    course,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeSponsorPayment(p) {
  return {
    id: String(p._id),
    type: p.type,
    amount: p.amount,
    currency: p.currency,
    costPerClick: p.costPerClick,
    status: p.status,
    stripeSessionId: p.stripeSessionId,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
    instructor: p.instructor
      ? {
          id: String(p.instructor._id || p.instructor),
          name: p.instructor.name,
          email: p.instructor.email,
        }
      : null,
    course: p.course
      ? {
          id: String(p.course._id || p.course),
          title: p.course.title,
        }
      : null,
    sponsorship: p.sponsorship ? String(p.sponsorship._id || p.sponsorship) : null,
  };
}

/** Public: featured / sponsored courses for home & listings */
export const listFeaturedSponsored = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 12;
  const rows = await getActiveSponsoredRows(limit);
  const data = mergeSponsoredFirst([], rows, limit);

  const ids = rows.map((r) => r._id);
  if (ids.length) {
    await CourseSponsorship.updateMany(
      { _id: { $in: ids } },
      { $inc: { impressions: 1 } }
    );
  }

  res.json({ success: true, data });
});

/**
 * Instructor overview: all own courses + published flag + active sponsorship
 */
export const instructorSponsorOverview = asyncHandler(async (req, res) => {
  const courses = await Course.find({ instructor: req.user._id })
    .select("title status thumbnail price studentsCount rating createdAt")
    .sort({ createdAt: -1 });

  const courseIds = courses.map((c) => c._id);
  const sponsorships = await CourseSponsorship.find({
    instructor: req.user._id,
    course: { $in: courseIds },
    status: { $in: ["active", "paused", "exhausted"] },
  }).sort({ updatedAt: -1 });

  const byCourse = new Map();
  for (const s of sponsorships) {
    const key = String(s.course);
    if (!byCourse.has(key)) byCourse.set(key, s);
  }

  const data = courses.map((c) => {
    const s = byCourse.get(String(c._id));
    return {
      id: String(c._id),
      title: c.title,
      status: c.status,
      published: c.status === "published",
      thumbnail: c.thumbnail?.url || null,
      price: c.price,
      studentsCount: c.studentsCount,
      rating: c.rating,
      sponsorship: s ? serializeSponsorship(s) : null,
    };
  });

  res.json({
    success: true,
    data,
    meta: {
      total: data.length,
      published: data.filter((c) => c.published).length,
      sponsored: data.filter((c) => c.sponsorship?.live).length,
    },
  });
});

/** Create sponsorship — commission activates immediately; PPC redirects to Stripe */
export const createSponsorship = asyncHandler(async (req, res) => {
  const {
    courseId,
    method,
    commissionPercent,
    costPerClick,
    budget,
    endsAt,
  } = req.body || {};

  if (!courseId) throwHttp(res, 400, "courseId is required");
  if (!["commission", "ppc"].includes(method)) {
    throwHttp(res, 400, "method must be 'commission' or 'ppc'");
  }

  const course = await Course.findById(courseId);
  if (!course) throwHttp(res, 404, "Course not found");
  if (String(course.instructor) !== String(req.user._id)) {
    throwHttp(res, 403, "Not your course");
  }
  if (course.status !== "published") {
    throwHttp(res, 400, "Only published courses can be sponsored");
  }

  if (method === "commission") {
    await CourseSponsorship.updateMany(
      {
        course: course._id,
        instructor: req.user._id,
        status: { $in: ["active", "paused", "exhausted"] },
      },
      { $set: { status: "ended" } }
    );

    const pct = Number(commissionPercent);
    if (!Number.isFinite(pct) || pct < 5 || pct > 50) {
      throwHttp(res, 400, "commissionPercent must be between 5 and 50");
    }

    const row = await CourseSponsorship.create({
      course: course._id,
      instructor: req.user._id,
      method: "commission",
      status: "active",
      startsAt: new Date(),
      endsAt: endsAt ? new Date(endsAt) : null,
      commissionPercent: pct,
      costPerClick: 0,
      budget: 0,
      spent: 0,
      clicks: 0,
      impressions: 0,
    });
    await row.populate("course", "title status thumbnail price studentsCount rating");

    return res.status(201).json({
      success: true,
      data: serializeSponsorship(row),
      checkout: false,
      message: "Course sponsorship activated",
    });
  }

  // —— PPC: charge budget via Stripe before activating ——
  assertStripeConfigured();
  const cpc = Number(costPerClick);
  const bud = Number(budget);
  if (!Number.isFinite(cpc) || cpc < 0.01) {
    throwHttp(res, 400, "costPerClick must be at least $0.01");
  }
  if (!Number.isFinite(bud) || bud < cpc) {
    throwHttp(res, 400, "budget must be at least one click");
  }

  const { payment, url, sessionId } = await createSponsorCheckout({
    instructor: req.user,
    course,
    type: "ppc_budget",
    amount: Math.round(bud * 100) / 100,
    costPerClick: Math.round(cpc * 100) / 100,
    customerEmail: req.user.email,
  });

  res.status(201).json({
    success: true,
    checkout: true,
    url,
    sessionId,
    payment: serializeSponsorPayment(payment),
    message: "Complete Stripe payment to activate PPC sponsorship",
  });
});

export const updateSponsorship = asyncHandler(async (req, res) => {
  const row = await CourseSponsorship.findById(req.params.id);
  if (!row) throwHttp(res, 404, "Sponsorship not found");
  if (String(row.instructor) !== String(req.user._id)) {
    throwHttp(res, 403, "Not your sponsorship");
  }
  if (row.status === "ended") {
    throwHttp(res, 400, "Sponsorship already ended");
  }

  const { status, commissionPercent, costPerClick, budgetTopUp, endsAt } =
    req.body || {};

  if (status) {
    if (!["active", "paused", "ended"].includes(status)) {
      throwHttp(res, 400, "Invalid status");
    }
    if (status === "active" && row.method === "ppc") {
      if (Number(row.spent) >= Number(row.budget)) {
        throwHttp(res, 400, "Budget exhausted — add budget before reactivating");
      }
      row.status = "active";
    } else {
      row.status = status;
    }
  }

  if (row.method === "commission" && commissionPercent != null) {
    const pct = Number(commissionPercent);
    if (!Number.isFinite(pct) || pct < 5 || pct > 50) {
      throwHttp(res, 400, "commissionPercent must be between 5 and 50");
    }
    row.commissionPercent = pct;
  }

  if (row.method === "ppc" && costPerClick != null) {
    const cpc = Number(costPerClick);
    if (!Number.isFinite(cpc) || cpc < 0.01) {
      throwHttp(res, 400, "costPerClick must be at least $0.01");
    }
    row.costPerClick = Math.round(cpc * 100) / 100;
  }

  // PPC top-up requires Stripe payment
  if (row.method === "ppc" && budgetTopUp != null) {
    assertStripeConfigured();
    const top = Number(budgetTopUp);
    if (!Number.isFinite(top) || top <= 0) {
      throwHttp(res, 400, "budgetTopUp must be positive");
    }

    const course = await Course.findById(row.course);
    if (!course) throwHttp(res, 404, "Course not found");

    const { payment, url, sessionId } = await createSponsorCheckout({
      instructor: req.user,
      course,
      type: "ppc_topup",
      amount: Math.round(top * 100) / 100,
      costPerClick: row.costPerClick,
      sponsorshipId: row._id,
      customerEmail: req.user.email,
    });

    return res.json({
      success: true,
      checkout: true,
      url,
      sessionId,
      payment: serializeSponsorPayment(payment),
      message: "Complete Stripe payment to add budget",
    });
  }

  if (endsAt !== undefined) {
    row.endsAt = endsAt ? new Date(endsAt) : null;
  }

  await row.save();
  await row.populate("course", "title status thumbnail price studentsCount rating");

  res.json({ success: true, data: serializeSponsorship(row), checkout: false });
});

export const endSponsorship = asyncHandler(async (req, res) => {
  const row = await CourseSponsorship.findById(req.params.id);
  if (!row) throwHttp(res, 404, "Sponsorship not found");
  if (String(row.instructor) !== String(req.user._id)) {
    throwHttp(res, 403, "Not your sponsorship");
  }
  row.status = "ended";
  await row.save();
  res.json({ success: true, message: "Sponsorship ended" });
});

/** Verify Stripe session after PPC checkout return */
export const verifySponsorCheckout = asyncHandler(async (req, res) => {
  const sessionId = req.query.session_id || req.body?.sessionId;
  if (!sessionId) throwHttp(res, 400, "session_id required");

  const stripe = assertStripeConfigured();
  const session = await stripe.checkout.sessions.retrieve(String(sessionId));

  if (
    session.metadata?.instructorId &&
    String(session.metadata.instructorId) !== String(req.user._id)
  ) {
    throwHttp(res, 403, "This checkout session does not belong to you");
  }

  const paymentId = session.metadata?.sponsorPaymentId;
  if (!paymentId || session.metadata?.type !== "sponsor_payment") {
    throwHttp(res, 400, "Not a sponsor payment session");
  }

  const payment = await SponsorPayment.findById(paymentId);
  if (!payment) throwHttp(res, 404, "Sponsor payment not found");

  const result = await fulfillSponsorPayment(payment, session);
  if (!result.ok && result.reason === "not_paid") {
    throwHttp(res, 402, "Payment not completed yet");
  }
  if (!result.ok) {
    throwHttp(res, 400, `Could not fulfill sponsor checkout (${result.reason})`);
  }

  let sponsorship = result.sponsorship;
  if (!sponsorship && payment.sponsorship) {
    sponsorship = await CourseSponsorship.findById(payment.sponsorship).populate(
      "course",
      "title status thumbnail price studentsCount rating"
    );
  } else if (sponsorship) {
    await sponsorship.populate(
      "course",
      "title status thumbnail price studentsCount rating"
    );
  }

  res.json({
    success: true,
    alreadyPaid: Boolean(result.alreadyPaid),
    payment: serializeSponsorPayment(result.payment),
    data: sponsorship ? serializeSponsorship(sponsorship) : null,
  });
});

/**
 * Track a PPC click on a sponsored course.
 * Deducts costPerClick from prepaid budget; marks exhausted when spent >= budget.
 */
export const trackSponsorClick = asyncHandler(async (req, res) => {
  const courseId = req.params.courseId;
  const now = new Date();

  const row = await CourseSponsorship.findOne({
    course: courseId,
    status: "active",
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
  }).sort({ updatedAt: -1 });

  if (!row) {
    return res.json({ success: true, charged: false, reason: "not_sponsored" });
  }

  if (row.method !== "ppc") {
    return res.json({
      success: true,
      charged: false,
      reason: "commission",
      method: "commission",
    });
  }

  const cpc = Number(row.costPerClick) || 0;
  if (Number(row.spent) + cpc > Number(row.budget) + 0.001) {
    row.status = "exhausted";
    await row.save();
    return res.json({ success: true, charged: false, reason: "exhausted" });
  }

  row.clicks += 1;
  row.spent = Math.round((Number(row.spent) + cpc) * 100) / 100;
  if (row.spent >= row.budget) row.status = "exhausted";
  await row.save();

  res.json({
    success: true,
    charged: true,
    costPerClick: cpc,
    spent: row.spent,
    remaining: Math.max(0, row.budget - row.spent),
    status: row.status,
  });
});

/** Admin: list PPC sponsor Stripe payments */
export const listSponsorPayments = asyncHandler(async (_req, res) => {
  const data = await SponsorPayment.find()
    .populate("instructor", "name email")
    .populate("course", "title")
    .populate("sponsorship", "method status budget spent clicks costPerClick")
    .sort({ createdAt: -1 })
    .limit(200);

  res.json({
    success: true,
    data: data.map((p) => ({
      ...serializeSponsorPayment(p),
      _id: String(p._id),
      sponsorshipDetail: p.sponsorship
        ? {
            id: String(p.sponsorship._id),
            status: p.sponsorship.status,
            budget: p.sponsorship.budget,
            spent: p.sponsorship.spent,
            clicks: p.sponsorship.clicks,
            costPerClick: p.sponsorship.costPerClick,
          }
        : null,
    })),
  });
});
