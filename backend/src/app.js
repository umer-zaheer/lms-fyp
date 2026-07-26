import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/authRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import courseRoutes from "./routes/courseRoutes.js";
import enrollmentRoutes from "./routes/enrollmentRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import stripeRoutes from "./routes/stripeRoutes.js";
import quizRoutes from "./routes/quizRoutes.js";
import channelRoutes from "./routes/channelRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import miscRoutes from "./routes/miscRoutes.js";
import liveSessionRoutes from "./routes/liveSessionRoutes.js";
import sponsorRoutes from "./routes/sponsorRoutes.js";
import { stripeWebhook } from "./controllers/stripeController.js";

const app = express();

/** Comma-separated origins in CORS_ORIGINS, or CLIENT_URL, plus common local dev */
function corsOrigins() {
  const fromEnv = [
    process.env.CLIENT_URL,
    ...(process.env.CORS_ORIGINS || "").split(","),
  ]
    .map((s) => (s || "").trim().replace(/\/$/, ""))
    .filter(Boolean);

  const defaults = [
    "http://localhost:8080",
    "http://localhost:5173",
    "http://127.0.0.1:8080",
  ];

  return [...new Set([...fromEnv, ...defaults])];
}

const allowedOrigins = corsOrigins();

app.use(
  cors({
    origin(origin, callback) {
      // Non-browser / same-origin tools may omit Origin
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Allow Vercel preview deployments for this project
      if (/^https:\/\/[\w-]+-[\w-]+-[\w.-]+\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

// Stripe webhook needs raw body — must be before express.json()
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "LMS API is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/live-sessions", liveSessionRoutes);
app.use("/api/sponsor", sponsorRoutes);
app.use("/api", miscRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
