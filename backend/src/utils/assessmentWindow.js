/** Availability window for quizzes / assignments */
export function getWindowStatus(startAt, endAt, now = new Date()) {
  const t = now.getTime();
  const start = startAt ? new Date(startAt).getTime() : null;
  const end = endAt ? new Date(endAt).getTime() : null;

  if (start && Number.isFinite(start) && t < start) {
    return {
      canOpen: false,
      status: "upcoming",
      message: "Not open yet — wait until the start time",
      startAt: startAt || null,
      endAt: endAt || null,
    };
  }
  if (end && Number.isFinite(end) && t > end) {
    return {
      canOpen: false,
      status: "ended",
      message: "Deadline passed — this assessment is closed",
      startAt: startAt || null,
      endAt: endAt || null,
    };
  }
  return {
    canOpen: true,
    status: "open",
    message: "Open now",
    startAt: startAt || null,
    endAt: endAt || null,
  };
}

export function parseDateOrNull(value) {
  if (value == null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
