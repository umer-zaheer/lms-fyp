import CourseSponsorship from "../models/CourseSponsorship.js";

/** True if sponsorship is currently featured */
export function isSponsorshipLive(s) {
  if (!s || s.status !== "active") return false;
  const now = new Date();
  if (s.startsAt && s.startsAt > now) return false;
  if (s.endsAt && s.endsAt <= now) return false;
  if (s.method === "ppc" && Number(s.spent) >= Number(s.budget)) return false;
  return true;
}

/**
 * Prepend active sponsored courses to a list (dedupe by _id).
 * Marks each sponsored course with `sponsored: true` and sponsor meta.
 */
export function mergeSponsoredFirst(courses, sponsoredRows, limit) {
  const out = [];
  const seen = new Set();

  for (const row of sponsoredRows || []) {
    const c = row.course?.toObject ? row.course.toObject() : row.course;
    if (!c?._id) continue;
    const id = String(c._id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      ...c,
      sponsored: true,
      sponsorship: {
        id: String(row._id),
        method: row.method,
        commissionPercent: row.commissionPercent,
        costPerClick: row.costPerClick,
      },
    });
    if (limit && out.length >= limit) return out;
  }

  for (const c of courses || []) {
    const obj = c?.toObject ? c.toObject() : c;
    const id = String(obj._id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...obj, sponsored: Boolean(obj.sponsored) });
    if (limit && out.length >= limit) break;
  }

  return out;
}

export async function getActiveSponsoredRows(limit = 20) {
  return CourseSponsorship.listActiveSponsored(limit);
}

/** Extra platform fee % from an active commission sponsorship, or 0 */
export async function getExtraCommissionPercent(courseId) {
  const now = new Date();
  const row = await CourseSponsorship.findOne({
    course: courseId,
    method: "commission",
    status: "active",
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
  }).sort({ updatedAt: -1 });

  if (!row) return 0;
  return Math.max(0, Number(row.commissionPercent) || 0);
}
