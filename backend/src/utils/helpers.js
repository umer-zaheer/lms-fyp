import slugify from "slugify";

export const makeSlug = (text) =>
  slugify(text, { lower: true, strict: true, trim: true }) +
  "-" +
  Math.random().toString(36).slice(2, 7);

export const throwHttp = (res, status, message) => {
  res.status(status);
  throw new Error(message);
};
