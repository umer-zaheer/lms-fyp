const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err, _req, res, _next) => {
  let statusCode = err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
  if (err.name === "ValidationError") statusCode = 400;
  if (err.code === 11000) statusCode = 400;

  res.status(statusCode).json({
    success: false,
    message: err.code === 11000 ? "Duplicate entry" : err.message || "Server Error",
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });
};

export { notFound, errorHandler };
