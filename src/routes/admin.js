import crypto from "crypto";
import { Router } from "express";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Payment } from "../models/Payment.js";
import { requireAdminAccess, signAdminToken } from "../middleware/auth.js";

const router = Router();

function adminConfigured() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  return Boolean(email && password);
}

function verifyAdminPassword(plain, expectedFromEnv) {
  if (expectedFromEnv == null || plain == null) return false;
  const a = crypto.createHash("sha256").update(String(plain), "utf8").digest();
  const b = crypto.createHash("sha256").update(String(expectedFromEnv), "utf8").digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post("/login", (req, res) => {
  if (!adminConfigured()) {
    return res.status(503).json({
      message:
        "Admin login is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD on the server.",
    });
  }

  const expectedEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const invalid = () => res.status(401).json({ message: "Invalid email or password." });

  if (email !== expectedEmail) return invalid();
  if (!verifyAdminPassword(password, process.env.ADMIN_PASSWORD)) return invalid();

  res.json({ token: signAdminToken() });
});

router.get("/metrics", requireAdminAccess, async (_req, res, next) => {
  try {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 86400000);
    const d30 = new Date(now.getTime() - 30 * 86400000);

    const [
      usersTotal,
      usersLast7d,
      usersLast30d,
      paymentsCompletedCount,
      paymentsCompletedSum,
      paymentsByStatus,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: d7 } }),
      User.countDocuments({ createdAt: { $gte: d30 } }),
      Payment.countDocuments({ status: "completed" }),
      Payment.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, totalUsd: { $sum: "$amount" } } },
      ]),
      Payment.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const totalPurchasesUsd = paymentsCompletedSum[0]?.totalUsd ?? 0;

    res.json({
      generatedAt: now.toISOString(),
      users: {
        total: usersTotal,
        registeredLast7Days: usersLast7d,
        registeredLast30Days: usersLast30d,
      },
      purchases: {
        completedCount: paymentsCompletedCount,
        completedRevenueUsd: Math.round(totalPurchasesUsd * 100) / 100,
        byStatus: paymentsByStatus.map((r) => ({ status: r._id, count: r.count })),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/charts/growth", requireAdminAccess, async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
    const since = new Date(Date.now() - days * 86400000);

    const [usersByDay, revenueByDay] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Payment.aggregate([
        { $match: { status: "completed", createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const allDays = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86400000);
      return d.toISOString().slice(0, 10);
    });

    const userMap = Object.fromEntries(usersByDay.map((r) => [r._id, r.count]));
    const revMap = Object.fromEntries(
      revenueByDay.map((r) => [r._id, { revenue: r.revenue, count: r.count }])
    );

    res.json({
      days: allDays.map((day) => ({
        date: day,
        users: userMap[day] || 0,
        revenue: Math.round((revMap[day]?.revenue || 0) * 100) / 100,
        payments: revMap[day]?.count || 0,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/users/:id/credits", requireAdminAccess, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const { add, set } = req.body;

    if (add === undefined && set === undefined) {
      return res.status(400).json({
        message: "Provide either 'add' (relative) or 'set' (absolute) credits.",
      });
    }

    let user;
    if (set !== undefined) {
      const val = parseInt(set, 10);
      if (isNaN(val) || val < 0) {
        return res.status(400).json({ message: "'set' must be a non-negative integer." });
      }
      user = await User.findByIdAndUpdate(
        req.params.id,
        { $set: { publishingCredits: val, creditsRemaining: val } },
        { new: true }
      );
    } else {
      const delta = parseInt(add, 10);
      if (isNaN(delta)) {
        return res.status(400).json({ message: "'add' must be an integer." });
      }
      user = await User.findByIdAndUpdate(
        req.params.id,
        { $inc: { publishingCredits: delta, creditsRemaining: delta } },
        { new: true }
      );
      if ((user?.publishingCredits ?? 0) < 0) {
        user = await User.findByIdAndUpdate(
          req.params.id,
          { $set: { publishingCredits: 0, creditsRemaining: 0 } },
          { new: true }
        );
      }
    }

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      id: String(user._id),
      publishingCredits: user.publishingCredits ?? 0,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/users", requireAdminAccess, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim() || "";

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      users: users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        publishingCredits: u.publishingCredits ?? 0,
        authType: "email",
        createdAt: u.createdAt,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/users/:id", requireAdminAccess, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const user = await User.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    const payments = await Payment.find({ userId: user._id }).sort({ createdAt: -1 }).lean();

    res.json({
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        publishingCredits: user.publishingCredits ?? 0,
        authType: "email",
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      payments: payments.map((p) => ({
        id: String(p._id),
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        productType: p.productType,
        creditsGranted: p.publishingCreditsGranted,
        method: p.paymentMethod,
        payerEmail: p.payerEmail,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/payments", requireAdminAccess, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const status = req.query.status || "";

    const filter = {};
    if (status) filter.status = status;

    const [payments, total] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Payment.countDocuments(filter),
    ]);

    const userIds = [...new Set(payments.map((p) => String(p.userId)))];
    const users = await User.find({ _id: { $in: userIds } })
      .select("name email")
      .lean();
    const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

    res.json({
      payments: payments.map((p) => ({
        id: String(p._id),
        userId: String(p.userId),
        user: userMap[String(p.userId)]
          ? { name: userMap[String(p.userId)].name, email: userMap[String(p.userId)].email }
          : null,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        productType: p.productType,
        creditsGranted: p.publishingCreditsGranted,
        method: p.paymentMethod,
        payerEmail: p.payerEmail,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
