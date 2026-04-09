import Razorpay from "razorpay";
import crypto from "crypto";
import { paypal, getPayPalClient } from "../config/paypal.js";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";
import { TOKEN_PACK_MAP, TOKEN_PACKS } from "../config/tokenPacks.js";
import { formatPayPalSdkError } from "../utils/paypalErrors.js";

function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function usdToInrPaise(amountUsd) {
  const rate = Number(process.env.RAZORPAY_USD_TO_INR) || 84;
  return Math.round(amountUsd * rate * 100);
}

const FRONTEND_URL = () =>
  (process.env.FRONTEND_URL || "http://localhost:1420").replace(/\/$/, "");

function resolvePack(productType) {
  if (TOKEN_PACK_MAP[productType]) return TOKEN_PACK_MAP[productType];

  if (productType === "go_live") {
    const raw = process.env.PAYPAL_GO_LIVE_AMOUNT_USD;
    const amount = raw != null && raw !== "" ? Number(raw) : 5;
    const rawC = process.env.PAYPAL_GO_LIVE_PUBLISHING_CREDITS;
    const credits = rawC != null && rawC !== "" ? Number.parseInt(String(rawC), 10) : 1;
    return {
      id: "go_live",
      credits: Number.isFinite(credits) && credits > 0 ? credits : 1,
      amountUsd: Number.isFinite(amount) && amount >= 0 ? amount : 5,
      label: "YouTube Downloader pass",
      description: "Download credits",
    };
  }

  return null;
}

export async function getTokenPacks(_req, res) {
  res.json({ packs: TOKEN_PACKS });
}

export async function createOrder(req, res) {
  try {
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      return res.status(503).json({
        message: "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.",
      });
    }

    const productType = String(req.body?.productType || "go_live");
    const pack = resolvePack(productType);
    if (!pack) {
      return res.status(400).json({ message: "Unsupported productType" });
    }

    const amount = pack.amountUsd;
    const creditsGranted = pack.credits;
    const userId = req.userId;

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: `${pack.label} — ${creditsGranted} download credit${creditsGranted !== 1 ? "s" : ""}`,
          amount: {
            currency_code: "USD",
            value: amount.toFixed(2),
          },
          reference_id: productType,
        },
      ],
      application_context: {
        brand_name: "YouTube Downloader",
        locale: "en-US",
        landing_page: "NO_PREFERENCE",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: `${FRONTEND_URL()}/?paypal=success`,
        cancel_url: `${FRONTEND_URL()}/?paypal=cancelled`,
      },
    });

    const order = await getPayPalClient().execute(request);

    const payment = await Payment.create({
      userId,
      paypalOrderId: order.result.id,
      amount,
      currency: "USD",
      status: "created",
      productType,
      publishingCreditsGranted: creditsGranted,
      paypalResponse: order.result,
    });

    res.status(201).json({
      orderId: order.result.id,
      paymentId: String(payment._id),
      amountUsd: amount,
      publishingCreditsGranted: creditsGranted,
    });
  } catch (e) {
    console.error("createOrder error:", e);
    const msg = formatPayPalSdkError(e);
    const status =
      typeof e.statusCode === "number" &&
      e.statusCode >= 400 &&
      e.statusCode < 600
        ? e.statusCode
        : 502;
    return res.status(status).json({ message: msg });
  }
}

export async function captureOrder(req, res) {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }
    const userId = req.userId;

    const payment = await Payment.findOne({
      paypalOrderId: orderId,
      userId,
    });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }
    if (payment.status === "completed") {
      return res.status(400).json({ message: "Payment already completed" });
    }

    const captureReq = new paypal.orders.OrdersCaptureRequest(orderId);
    captureReq.requestBody({});

    const capture = await getPayPalClient().execute(captureReq);

    if (capture.result.status === "COMPLETED") {
      const pu = capture.result.purchase_units?.[0];
      const cap = pu?.payments?.captures?.[0];
      const payer = capture.result.payer;
      let payerName;
      if (payer?.name) {
        const g = payer.name.given_name || "";
        const s = payer.name.surname || "";
        payerName = `${g} ${s}`.trim();
      }

      const updatedPayment = await Payment.findOneAndUpdate(
        {
          _id: payment._id,
          userId,
          status: { $ne: "completed" },
        },
        {
          $set: {
            status: "completed",
            paypalPaymentId: cap?.id,
            paypalResponse: capture.result,
            completedAt: new Date(),
            ...(payer?.email_address && { payerEmail: payer.email_address }),
            ...(payerName && { payerName }),
          },
        },
        { new: true }
      );

      if (!updatedPayment) {
        const existing = await Payment.findOne({
          paypalOrderId: orderId,
          userId,
        }).lean();
        if (existing?.status === "completed") {
          const u = await User.findById(userId).lean();
          return res.json({
            payment: {
              id: String(existing._id),
              status: existing.status,
              publishingCreditsGranted: existing.publishingCreditsGranted,
            },
            user: {
              publishingCredits: u?.publishingCredits ?? 0,
              creditsRemaining: u?.creditsRemaining ?? 0,
            },
          });
        }
        return res.status(400).json({
          message: "Could not finalize payment. Try again or contact support.",
        });
      }

      const creditsToAdd = updatedPayment.publishingCreditsGranted;
      const user = await User.findByIdAndUpdate(
        userId,
        { $inc: { publishingCredits: creditsToAdd } },
        { new: true }
      );

      if (!user) {
        console.error("captureOrder: user not found after payment", userId);
        return res.status(500).json({
          message: "Payment recorded but account update failed. Contact support.",
        });
      }

      return res.json({
        payment: {
          id: String(updatedPayment._id),
          status: updatedPayment.status,
          publishingCreditsGranted: updatedPayment.publishingCreditsGranted,
        },
        user: {
          publishingCredits: user.publishingCredits ?? 0,
          creditsRemaining: user.creditsRemaining ?? 0,
        },
      });
    }

    payment.status = "failed";
    payment.paypalResponse = capture.result;
    await payment.save();

    return res.status(400).json({
      message: `Payment not completed. Status: ${capture.result.status}`,
    });
  } catch (e) {
    console.error("captureOrder error:", e);
    const msg = formatPayPalSdkError(e);
    const status =
      typeof e.statusCode === "number" &&
      e.statusCode >= 400 &&
      e.statusCode < 600
        ? e.statusCode
        : 502;
    return res.status(status).json({ message: msg });
  }
}

export async function getPaymentHistory(req, res, next) {
  try {
    const payments = await Payment.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ payments, count: payments.length });
  } catch (e) {
    next(e);
  }
}

export async function getPaymentById(req, res, next) {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.userId,
    }).lean();

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }
    res.json({ payment });
  } catch (e) {
    next(e);
  }
}

export function getRazorpayKeyId(_req, res) {
  res.json({ keyId: process.env.RAZORPAY_KEY_ID || "" });
}

export async function createRazorpayOrder(req, res, next) {
  try {
    const rzp = getRazorpayClient();
    if (!rzp) {
      return res.status(503).json({
        message: "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
      });
    }

    const productType = String(req.body?.productType || "go_live");
    const pack = resolvePack(productType);
    if (!pack) {
      return res.status(400).json({ message: "Unsupported productType" });
    }

    const amountPaise = usdToInrPaise(pack.amountUsd);
    const userId = req.userId;

    const order = await rzp.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `ytdl_${Date.now()}`,
      notes: {
        productType,
        userId: String(userId),
        credits: String(pack.credits),
      },
    });

    const payment = await Payment.create({
      userId,
      paypalOrderId: order.id,
      amount: pack.amountUsd,
      currency: "INR",
      status: "created",
      productType,
      publishingCreditsGranted: pack.credits,
      paymentMethod: "razorpay",
      paypalResponse: order,
    });

    res.status(201).json({
      orderId: order.id,
      paymentId: String(payment._id),
      amountPaise,
      currency: "INR",
      pack: { label: pack.label, credits: pack.credits, amountUsd: pack.amountUsd },
    });
  } catch (e) {
    console.error("createRazorpayOrder error:", e);
    next(e);
  }
}

export async function verifyRazorpayPayment(req, res, next) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentId) {
      return res.status(400).json({ message: "Missing required fields for verification." });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(503).json({ message: "Razorpay not configured on server." });
    }

    const expectedSig = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ message: "Payment verification failed: invalid signature." });
    }

    const userId = req.userId;
    const payment = await Payment.findOne({ _id: paymentId, userId });
    if (!payment) {
      return res.status(404).json({ message: "Payment record not found." });
    }
    if (payment.status === "completed") {
      const u = await User.findById(userId).lean();
      return res.json({
        payment: {
          id: String(payment._id),
          status: payment.status,
          publishingCreditsGranted: payment.publishingCreditsGranted,
        },
        user: {
          publishingCredits: u?.publishingCredits ?? 0,
          creditsRemaining: u?.creditsRemaining ?? 0,
        },
      });
    }

    const updatedPayment = await Payment.findOneAndUpdate(
      {
        _id: paymentId,
        userId,
        status: { $ne: "completed" },
      },
      {
        $set: {
          status: "completed",
          paypalPaymentId: razorpay_payment_id,
          completedAt: new Date(),
          paypalResponse: { razorpay_order_id, razorpay_payment_id, razorpay_signature },
        },
      },
      { new: true }
    );

    if (!updatedPayment) {
      return res.status(400).json({ message: "Could not finalize payment." });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { publishingCredits: updatedPayment.publishingCreditsGranted } },
      { new: true }
    );

    if (!user) {
      return res.status(500).json({ message: "User not found after payment." });
    }

    return res.json({
      payment: {
        id: String(updatedPayment._id),
        status: updatedPayment.status,
        publishingCreditsGranted: updatedPayment.publishingCreditsGranted,
      },
      user: {
        publishingCredits: user.publishingCredits ?? 0,
        creditsRemaining: user.creditsRemaining ?? 0,
      },
    });
  } catch (e) {
    console.error("verifyRazorpayPayment error:", e);
    next(e);
  }
}
