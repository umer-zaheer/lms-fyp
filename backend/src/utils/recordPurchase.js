import Earning from "../models/Earning.js";
import { getDateParts } from "./dateParts.js";

/**
 * Stamp year/month/day on a payment and upsert an Earning row for charts.
 */
export async function recordPaidPurchase({
  payment,
  enrollment = null,
  when = new Date(),
}) {
  const parts = getDateParts(when);

  payment.purchasedAt = parts.at;
  payment.year = parts.year;
  payment.month = parts.month;
  payment.day = parts.day;
  await payment.save();

  await Earning.findOneAndUpdate(
    { student: payment.student, course: payment.course },
    {
      student: payment.student,
      instructor: payment.instructor,
      course: payment.course,
      payment: payment._id,
      enrollment: enrollment?._id || enrollment || undefined,
      amountTotal: payment.amountTotal || 0,
      amount: payment.instructorAmount || 0,
      currency: payment.currency || "usd",
      purchasedAt: parts.at,
      year: parts.year,
      month: parts.month,
      day: parts.day,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return parts;
}

/** Stamp enrollment date parts (for monthly enrollment charts). */
export function applyEnrollmentDateParts(enrollment, when = new Date()) {
  const parts = getDateParts(when);
  enrollment.enrolledAt = parts.at;
  enrollment.year = parts.year;
  enrollment.month = parts.month;
  enrollment.day = parts.day;
  return parts;
}

/**
 * Free enrollments: still track earning at $0 so purchase timeline is complete,
 * or skip if amount is 0 — we record with amount 0 only when instructor wants history.
 * For free we skip Earning (no revenue) but enrollment date parts are enough.
 */
export async function recordFreePurchaseEarning({
  studentId,
  instructorId,
  courseId,
  enrollmentId,
  when = new Date(),
}) {
  const parts = getDateParts(when);
  await Earning.findOneAndUpdate(
    { student: studentId, course: courseId },
    {
      student: studentId,
      instructor: instructorId,
      course: courseId,
      enrollment: enrollmentId,
      amountTotal: 0,
      amount: 0,
      currency: "usd",
      purchasedAt: parts.at,
      year: parts.year,
      month: parts.month,
      day: parts.day,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return parts;
}
