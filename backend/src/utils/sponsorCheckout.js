import SponsorPayment from "../models/SponsorPayment.js";
import CourseSponsorship from "../models/CourseSponsorship.js";
import { getDateParts } from "./dateParts.js";
import { assertStripeConfigured } from "./stripe.js";

/**
 * Create pending SponsorPayment + Stripe Checkout Session for PPC budget/top-up.
 * Returns { payment, url, sessionId }.
 */
export async function createSponsorCheckout({
  instructor,
  course,
  type,
  amount,
  costPerClick = 0,
  sponsorshipId = null,
  customerEmail,
}) {
  const stripe = assertStripeConfigured();
  const amountDollars = Math.round(Number(amount) * 100) / 100;
  const amountCents = Math.round(amountDollars * 100);

  if (!Number.isFinite(amountDollars) || amountCents < 1) {
    const err = new Error("Invalid payment amount");
    err.statusCode = 400;
    throw err;
  }

  const payment = await SponsorPayment.create({
    instructor: instructor._id || instructor,
    course: course._id || course,
    sponsorship: sponsorshipId || null,
    type,
    amount: amountDollars,
    costPerClick: Number(costPerClick) || 0,
    currency: "usd",
    status: "pending",
  });

  const courseTitle = course.title || "Course";
  const label =
    type === "ppc_topup"
      ? `PPC budget top-up · ${courseTitle}`
      : `PPC sponsorship budget · ${courseTitle}`;

  const meta = {
    type: "sponsor_payment",
    sponsorPaymentId: payment._id.toString(),
    instructorId: String(instructor._id || instructor),
    courseId: String(course._id || course),
    sponsorType: type,
  };

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: customerEmail || instructor.email || undefined,
    client_reference_id: payment._id.toString(),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: label,
            description: `Pay-per-click advertising budget for "${courseTitle}"`.slice(
              0,
              200
            ),
          },
        },
      },
    ],
    metadata: meta,
    payment_intent_data: { metadata: meta },
    success_url: `${process.env.CLIENT_URL}/instructor/sponsor?sponsor=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.CLIENT_URL}/instructor/sponsor?sponsor=cancel`,
  });

  payment.stripeSessionId = session.id;
  await payment.save();

  return { payment, url: session.url, sessionId: session.id };
}

/** Apply paid PPC budget / top-up to CourseSponsorship */
export async function fulfillSponsorPayment(payment, session) {
  if (!payment) return { ok: false, reason: "payment_not_found" };
  if (payment.status === "paid") {
    return { ok: true, alreadyPaid: true, payment };
  }

  const paid =
    !session ||
    session.payment_status === "paid" ||
    session.status === "complete";
  if (!paid) return { ok: false, reason: "not_paid" };

  const parts = getDateParts(new Date());
  payment.status = "paid";
  payment.paidAt = parts.at;
  payment.year = parts.year;
  payment.month = parts.month;
  payment.day = parts.day;
  if (session) {
    payment.stripeSessionId = session.id || payment.stripeSessionId;
    payment.stripePaymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || payment.stripePaymentIntentId;
  }

  let sponsorship = null;

  if (payment.type === "ppc_budget") {
    // End prior live sponsorships for this course
    await CourseSponsorship.updateMany(
      {
        course: payment.course,
        instructor: payment.instructor,
        status: { $in: ["active", "paused", "exhausted"] },
      },
      { $set: { status: "ended" } }
    );

    sponsorship = await CourseSponsorship.create({
      course: payment.course,
      instructor: payment.instructor,
      method: "ppc",
      status: "active",
      commissionPercent: 0,
      costPerClick: Number(payment.costPerClick) || 0,
      budget: Number(payment.amount),
      spent: 0,
      clicks: 0,
      impressions: 0,
      startsAt: new Date(),
      endsAt: null,
    });
    payment.sponsorship = sponsorship._id;
  } else if (payment.type === "ppc_topup") {
    sponsorship = payment.sponsorship
      ? await CourseSponsorship.findById(payment.sponsorship)
      : null;

    if (!sponsorship) {
      await payment.save();
      return { ok: false, reason: "sponsorship_missing" };
    }

    sponsorship.budget =
      Math.round((Number(sponsorship.budget) + Number(payment.amount)) * 100) /
      100;
    if (sponsorship.status === "exhausted") {
      sponsorship.status = "active";
    }
    await sponsorship.save();
  }

  await payment.save();
  return { ok: true, payment, sponsorship };
}
