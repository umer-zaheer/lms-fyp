import "dotenv/config";
import http from "http";
import app from "./app.js";
import connectDB from "./config/db.js";
import { ensurePlatformStripeReady, getStripe } from "./utils/stripe.js";
import { initSocket } from "./socket.js";

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    await ensurePlatformStripeReady();

    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || "development"})`);
      if (getStripe()) {
        console.log("Stripe: configured (test/live keys loaded)");
      } else {
        console.log("Stripe: NOT configured — add STRIPE_SECRET_KEY");
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
