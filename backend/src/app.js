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

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:8080",
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
