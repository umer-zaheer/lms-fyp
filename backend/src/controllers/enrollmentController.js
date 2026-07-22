import asyncHandler from "express-async-handler";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import Payment from "../models/Payment.js";
import Certificate from "../models/Certificate.js";
import { Channel } from "../models/Channel.js";
import PlatformSettings from "../models/PlatformSettings.js";
import User from "../models/User.js";
import { applyCouponToCourse } from "../utils/pricing.js";
import { assertStripeConfigured, calcFeeSplit, ensurePlatformStripeReady } from "../utils/stripe.js";
import { throwHttp } from "../utils/helpers.js";

async function ensureChannel(course) {
  let channel = await Channel.findOne({ course: course._id });
  if (!channel) {
    channel = await Channel.create({
      course: course._id,
      name: `${course.title} · Class Channel`,
    });
  }
  return channel;
}

async function createEnrollment({ studentId, course, pricePaid, couponCode, paymentId }) {
  const enrollment = await Enrollment.create({
    student: studentId,
    course: course._id,
    pricePaid,
    couponCode,
    payment: paymentId,
  });

  course.studentsCount = (course.studentsCount || 0) + 1;
  await course.save();
  await ensureChannel(course);

  return enrollment;
}

export const myEnrollments = asyncHandler(async (req, res) => {
  const data = await Enrollment.find({ student: req.user._id })
    .populate({
      path: "course",
      populate: [
        { path: "instructor", select: "name avatar" },
        { path: "category", select: "name slug" },
      ],
    })
    .sort({ updatedAt: -1 });

  res.json({ success: true, data });
});

export const updateProgress = asyncHandler(async (req, res) => {
  const { lessonId, progress } = req.body;
  const enrollment = await Enrollment.findOne({
    student: req.user._id,
    course: req.params.courseId,
  });
  if (!enrollment) throwHttp(res, 404, "Not enrolled");

  if (lessonId && !enrollment.completedLessons.includes(lessonId)) {
    enrollment.completedLessons.push(lessonId);
  }
  if (progress != null) enrollment.progress = Math.min(100, Math.max(0, Number(progress)));

  if (enrollment.progress >= 100 && !enrollment.completedAt) {
    enrollment.completedAt = new Date();
    const code = `SB-${enrollment._id.toString().slice(-8).toUpperCase()}`;
    await Certificate.findOneAndUpdate(
      { student: req.user._id, course: enrollment.course },
      { student: req.user._id, course: enrollment.course, code, issuedAt: new Date() },
      { upsert: true, new: true }
    );
  }

  await enrollment.save();
  res.json({ success: true, data: enrollment });
});

/** Free enroll or start Stripe Checkout (80% instructor / 20% platform) */
export const checkoutCourse = asyncHandler(async (req, res) => {
  const { couponCode } = req.body;
  const course = await Course.findById(req.params.courseId).populate("category");
  if (!course || course.status !== "published") {
    throwHttp(res, 404, "Course not available");
  }

  const existing = await Enrollment.findOne({
    student: req.user._id,
    course: course._id,
  });
  if (existing) throwHttp(res, 400, "Already enrolled");

  const instructor = await User.findById(course.instructor);
  const settings =
    (await ensurePlatformStripeReady()) || (await PlatformSettings.getSettings());

  const { coupon, finalPrice } = await applyCouponToCourse(course, couponCode);
  const amountCents = Math.round(finalPrice * 100);

  if (amountCents === 0) {
    if (coupon) {
      coupon.usedCount += 1;
      await coupon.save();
    }
    const enrollment = await createEnrollment({
      studentId: req.user._id,
      course,
      pricePaid: 0,
      couponCode: coupon?.code,
    });
    return res.json({
      success: true,
      free: true,
      enrollment,
      message: "Enrolled for free",
    });
  }

  if (!settings.stripeConnected) {
    throwHttp(
      res,
      503,
      "Platform Stripe is disconnected. Admin must connect Stripe in Settings → Billing."
    );
  }

  const stripe = assertStripeConfigured();
  const feePercent =
    settings.platformFeePercent || Number(process.env.PLATFORM_FEE_PERCENT) || 20;
  const { platformFee, instructorAmount } = calcFeeSplit(amountCents, feePercent);

  // Refresh instructor Connect status from Stripe
  let connectReady = false;
  if (instructor?.stripeAccountId) {
    try {
      const acct = await stripe.accounts.retrieve(instructor.stripeAccountId);
      connectReady = Boolean(acct.charges_enabled);
      instructor.stripeOnboardingComplete = Boolean(
        acct.charges_enabled && acct.payouts_enabled
      );
      await instructor.save();
    } catch {
      connectReady = false;
    }
  }

  const payment = await Payment.create({
    student: req.user._id,
    instructor: instructor._id,
    course: course._id,
    amountTotal: amountCents / 100,
    platformFee: platformFee / 100,
    instructorAmount: instructorAmount / 100,
    couponCode: coupon?.code,
    status: "pending",
  });

  const meta = {
    paymentId: payment._id.toString(),
    courseId: course._id.toString(),
    studentId: req.user._id.toString(),
    couponCode: coupon?.code || "",
    payoutMode: connectReady ? "destination" : "platform_held",
  };

  const sessionConfig = {
    mode: "payment",
    customer_email: req.user.email,
    client_reference_id: payment._id.toString(),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: course.title,
            description: (
              course.shortDescription ||
              course.description ||
              "SkillBridge course"
            ).slice(0, 200),
          },
        },
      },
    ],
    metadata: meta,
    success_url: `${process.env.CLIENT_URL}/student/courses?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.CLIENT_URL}/courses/${course._id}?checkout=cancel`,
  };

  if (connectReady) {
    // Marketplace: 20% platform fee, 80% to instructor Connect account
    sessionConfig.payment_intent_data = {
      application_fee_amount: platformFee,
      transfer_data: {
        destination: instructor.stripeAccountId,
      },
      metadata: meta,
    };
  } else {
    // Instructor not onboarded yet — platform collects full amount; split recorded in DB
    sessionConfig.payment_intent_data = {
      metadata: meta,
    };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create(sessionConfig);
  } catch (err) {
    payment.status = "failed";
    await payment.save();
    console.error("Stripe Checkout create failed:", err);
    throwHttp(
      res,
      502,
      err.message || "Stripe Checkout failed. Check Connect settings / test keys."
    );
  }

  payment.stripeSessionId = session.id;
  await payment.save();

  res.json({
    success: true,
    url: session.url,
    sessionId: session.id,
    payoutMode: meta.payoutMode,
  });
});

export { createEnrollment, ensureChannel };
