import Coupon from "../models/Coupon.js";

/**
 * Resolve best applicable coupon for a course + optional code.
 * Returns { coupon, percentOff, finalPrice } where prices are in major currency units (dollars).
 */
export async function applyCouponToCourse(course, code) {
  const price = Number(course.price) || 0;
  if (!code) {
    return { coupon: null, percentOff: 0, finalPrice: price };
  }

  const coupon = await Coupon.findOne({
    code: code.toUpperCase().trim(),
    isActive: true,
  });

  if (!coupon) {
    const err = new Error("Invalid coupon code");
    err.statusCode = 400;
    throw err;
  }

  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    const err = new Error("Coupon has expired");
    err.statusCode = 400;
    throw err;
  }

  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    const err = new Error("Coupon usage limit reached");
    err.statusCode = 400;
    throw err;
  }

  const applies =
    (coupon.type === "course" && String(coupon.course) === String(course._id)) ||
    (coupon.type === "category" &&
      String(coupon.category) === String(course.category._id || course.category));

  if (!applies) {
    const err = new Error("Coupon does not apply to this course");
    err.statusCode = 400;
    throw err;
  }

  const percentOff = coupon.percentOff;
  const finalPrice = Math.max(0, Math.round(price * (1 - percentOff / 100) * 100) / 100);

  return { coupon, percentOff, finalPrice };
}

export function buildCourseSearchText(course) {
  const lessonText = (course.modules || [])
    .flatMap((m) => m.lessons || [])
    .map((l) => `${l.title} ${l.content || ""}`)
    .join(" ");
  return [course.title, course.shortDescription, course.description, ...(course.tags || []), lessonText]
    .filter(Boolean)
    .join("\n")
    .slice(0, 15000);
}
