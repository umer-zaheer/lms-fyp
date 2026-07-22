import Stripe from "stripe";
import PlatformSettings from "../models/PlatformSettings.js";

let stripe;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!stripe) {
    stripe = new Stripe(key);
  }
  return stripe;
}

export function assertStripeConfigured() {
  const s = getStripe();
  if (!s) {
    const err = new Error("Stripe is not configured. Add STRIPE_SECRET_KEY to .env");
    err.statusCode = 503;
    throw err;
  }
  return s;
}

export function calcFeeSplit(amountCents, feePercent = 20) {
  const platformFee = Math.round((amountCents * feePercent) / 100);
  const instructorAmount = amountCents - platformFee;
  return { platformFee, instructorAmount };
}

/** Enable marketplace flag automatically when secret key is present */
export async function ensurePlatformStripeReady() {
  if (!getStripe()) return null;
  const settings = await PlatformSettings.getSettings();
  if (!settings.stripeConnected) {
    settings.stripeConnected = true;
    settings.platformFeePercent =
      Number(process.env.PLATFORM_FEE_PERCENT) || settings.platformFeePercent || 20;
    await settings.save();
    console.log("Stripe platform auto-connected (keys detected)");
  }
  return settings;
}
