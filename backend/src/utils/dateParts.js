/** Split a Date into year / month (1–12) / day for analytics. */
export function getDateParts(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    at: d,
  };
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function monthLabel(month) {
  return MONTH_LABELS[(month || 1) - 1] || "Jan";
}

/** Last N calendar months as { year, month, label } (oldest → newest). */
export function lastNMonths(n = 12, from = new Date()) {
  const out = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    out.push({
      year,
      month,
      label: `${monthLabel(month)} ${year}`,
      shortLabel: monthLabel(month),
    });
  }
  return out;
}
