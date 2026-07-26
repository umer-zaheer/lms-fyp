import asyncHandler from "express-async-handler";
import PlatformSettings from "../models/PlatformSettings.js";
import User from "../models/User.js";
import Payment from "../models/Payment.js";
import SponsorPayment from "../models/SponsorPayment.js";
import Course from "../models/Course.js";
import Coupon from "../models/Coupon.js";
import Enrollment from "../models/Enrollment.js";
import { createEnrollment, addStudentToCourse } from "./enrollmentController.js";
import {
  assertStripeConfigured,
  ensurePlatformStripeReady,
  getStripe,
} from "../utils/stripe.js";
import { throwHttp } from "../utils/helpers.js";
import { recordPaidPurchase } from "../utils/recordPurchase.js";
import { fulfillSponsorPayment } from "../utils/sponsorCheckout.js";

export const platformStatus = asyncHandler(async (_req, res) => {
  const settings = (await ensurePlatformStripeReady()) || (await PlatformSettings.getSettings());
  const stripeReady = Boolean(getStripe());
  res.json({
    success: true,
    data: {
      stripeConnected: settings.stripeConnected,
      platformFeePercent: settings.platformFeePercent,
      stripeConfigured: stripeReady,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    },
  });
});

export const platformConnect = asyncHandler(async (req, res) => {
  if (!getStripe()) {
    throwHttp(res, 503, "Add STRIPE_SECRET_KEY to enable Stripe");
  }
  const settings = await PlatformSettings.getSettings();
  settings.stripeConnected = true;
  if (req.body.platformFeePercent != null) {
    settings.platformFeePercent = Number(req.body.platformFeePercent);
  } else {
    settings.platformFeePercent = Number(process.env.PLATFORM_FEE_PERCENT) || 20;
  }
  await settings.save();
  res.json({ success: true, data: settings, message: "Platform Stripe connected" });
});

export const platformDisconnect = asyncHandler(async (_req, res) => {
  const settings = await PlatformSettings.getSettings();
  settings.stripeConnected = false;
  await settings.save();
  res.json({ success: true, data: settings, message: "Platform Stripe disconnected" });
});

/** Instructor Express Connect onboarding */
export const instructorOnboard = asyncHandler(async (req, res) => {
  const stripe = assertStripeConfigured();
  let accountId = req.user.stripeAccountId;

  try {
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: req.user.email,
        country: process.env.STRIPE_COUNTRY || "US",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          product_description: "Online courses on SkillBridge LMS",
          url: process.env.CLIENT_URL || "http://localhost:8080",
        },
        metadata: { userId: req.user._id.toString() },
      });
      accountId = account.id;
      req.user.stripeAccountId = accountId;
      req.user.stripeOnboardingComplete = false;
      await req.user.save();
    }

    const account = await stripe.accounts.retrieve(accountId);
    const complete = Boolean(account.charges_enabled && account.details_submitted);

    if (complete) {
      req.user.stripeOnboardingComplete = true;
      await req.user.save();
      try {
        const loginLink = await stripe.accounts.createLoginLink(accountId);
        return res.json({
          success: true,
          url: loginLink.url,
          alreadyComplete: true,
        });
      } catch {
        // Login links can fail in some test setups — fall through to onboarding link
      }
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.CLIENT_URL}/instructor/earnings?stripe=refresh`,
      return_url: `${process.env.CLIENT_URL}/instructor/earnings?stripe=return`,
      type: "account_onboarding",
    });

    res.json({ success: true, url: link.url, alreadyComplete: false });
  } catch (err) {
    const msg = err?.message || "Stripe Connect failed";
    if (/signed up for Connect|enable Connect|Connect is not enabled/i.test(msg)) {
      throwHttp(
        res,
        400,
        "Enable Stripe Connect on your platform account first: open https://dashboard.stripe.com/test/connect (test mode) or https://dashboard.stripe.com/connect, click Get started, then try Connect Stripe again."
      );
    }
    if (/country/i.test(msg)) {
      throwHttp(
        res,
        400,
        `${msg} Set STRIPE_COUNTRY in backend .env to a Connect-supported country (e.g. US).`
      );
    }
    throwHttp(res, err.statusCode || 400, msg);
  }
});

export const instructorStripeStatus = asyncHandler(async (req, res) => {
  const stripe = getStripe();
  let onboardingComplete = req.user.stripeOnboardingComplete;
  let chargesEnabled = false;
  let detailsSubmitted = false;

  if (stripe && req.user.stripeAccountId) {
    try {
      const account = await stripe.accounts.retrieve(req.user.stripeAccountId);
      chargesEnabled = Boolean(account.charges_enabled);
      detailsSubmitted = Boolean(account.details_submitted);
      onboardingComplete = Boolean(account.charges_enabled && account.payouts_enabled);
      if (onboardingComplete !== req.user.stripeOnboardingComplete) {
        req.user.stripeOnboardingComplete = onboardingComplete;
        await req.user.save();
      }
    } catch (e) {
      console.warn("Stripe account retrieve failed:", e.message);
    }
  }

  res.json({
    success: true,
    data: {
      stripeAccountId: req.user.stripeAccountId || null,
      stripeOnboardingComplete: onboardingComplete,
      chargesEnabled,
      detailsSubmitted,
      stripeConfigured: Boolean(stripe),
      connectSetupUrl: "https://dashboard.stripe.com/test/connect",
    },
  });
});

/** Finalize enrollment from a paid Checkout Session (webhook or client return) */
export async function fulfillCheckoutSession(session) {
  // PPC sponsor budget checkouts
  if (session.metadata?.type === "sponsor_payment") {
    const payment = await SponsorPayment.findById(
      session.metadata.sponsorPaymentId
    );
    return fulfillSponsorPayment(payment, session);
  }

  const paymentId = session.metadata?.paymentId;
  if (!paymentId) return { ok: false, reason: "missing_payment_id" };

  const payment = await Payment.findById(paymentId);
  if (!payment) return { ok: false, reason: "payment_not_found" };

  if (payment.status === "paid") {
    const enrollment = await Enrollment.findOne({
      student: payment.student,
      course: payment.course,
    });
    // Ensure buyer id is on the course even for already-paid sessions
    await addStudentToCourse(payment.course, payment.student);
    return { ok: true, alreadyPaid: true, enrollment, payment };
  }

  // Only fulfill paid/complete sessions
  const paid =
    session.payment_status === "paid" ||
    session.status === "complete";
  if (!paid) return { ok: false, reason: "not_paid" };

  payment.status = "paid";
  payment.stripeSessionId = session.id || payment.stripeSessionId;
  payment.stripePaymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || payment.stripePaymentIntentId;
  await payment.save();

  const course = await Course.findById(payment.course);
  let enrollment = null;
  if (course) {
    enrollment = await Enrollment.findOne({
      student: payment.student,
      course: course._id,
    });
    if (!enrollment) {
      enrollment = await createEnrollment({
        studentId: payment.student,
        course,
        pricePaid: payment.amountTotal,
        couponCode: payment.couponCode,
        paymentId: payment._id,
      });
    } else {
      // Enrollment existed but enrolledUserIds may be missing
      await addStudentToCourse(course._id, payment.student);
    }
  }

  try {
    await recordPaidPurchase({ payment, enrollment });
  } catch (err) {
    console.error("recordPaidPurchase failed:", err.message);
  }

  if (payment.couponCode) {
    await Coupon.findOneAndUpdate(
      { code: payment.couponCode },
      { $inc: { usedCount: 1 } }
    );
  }

  return { ok: true, enrollment, payment };
}

export const verifyCheckoutSession = asyncHandler(async (req, res) => {
  const sessionId = req.query.session_id || req.body?.sessionId;
  if (!sessionId) throwHttp(res, 400, "session_id required");

  const stripe = assertStripeConfigured();
  const session = await stripe.checkout.sessions.retrieve(String(sessionId));

  // Ensure this student owns the payment
  if (
    session.metadata?.studentId &&
    String(session.metadata.studentId) !== String(req.user._id)
  ) {
    throwHttp(res, 403, "This checkout session does not belong to you");
  }

  const result = await fulfillCheckoutSession(session);
  if (!result.ok && result.reason === "not_paid") {
    throwHttp(res, 402, "Payment not completed yet");
  }
  if (!result.ok) {
    throwHttp(res, 400, `Could not fulfill checkout (${result.reason})`);
  }

  res.json({
    success: true,
    enrolled: true,
    alreadyPaid: Boolean(result.alreadyPaid),
    enrollment: result.enrollment,
    payment: result.payment,
  });
});

export const stripeWebhook = asyncHandler(async (req, res) => {
  const stripe = assertStripeConfigured();
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } else {
      event = Buffer.isBuffer(req.body)
        ? JSON.parse(req.body.toString("utf8"))
        : req.body;
    }
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    res.status(400);
    throw new Error(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      await fulfillCheckoutSession(event.data.object);
    }

    if (event.type === "account.updated") {
      const account = event.data.object;
      const user = await User.findOne({ stripeAccountId: account.id });
      if (user) {
        user.stripeOnboardingComplete = Boolean(
          account.charges_enabled && account.payouts_enabled
        );
        await user.save();
      }
    }
  } catch (e) {
    console.error("Webhook handler error:", e);
  }

  res.json({ received: true });
});
