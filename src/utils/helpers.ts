
// src/lib/dates.ts
export const toISODate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const tomorrowISO = (d = new Date()) => {
  const t = new Date(d);
  t.setDate(t.getDate() + 1);
  return toISODate(t);
};