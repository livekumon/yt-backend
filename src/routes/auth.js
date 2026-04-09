import { Router } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { requireAuth, signUserToken } from "../middleware/auth.js";

const router = Router();

function userResponse(user) {
  const plain = user?.toObject?.() ?? user;
  return {
    id: String(plain._id),
    email: plain.email,
    name: plain.name,
    publishingCredits: plain.publishingCredits ?? 0,
    creditsRemaining: plain.creditsRemaining ?? 0,
    createdAt: plain.createdAt,
  };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ field: "name", message: "Full name is required." });
    }
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ field: "email", message: "A valid email address is required." });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ field: "password", message: "Password must be at least 8 characters." });
    }

    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({
        field: "email",
        message: "An account with this email already exists. Sign in instead.",
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const emailNorm = String(email).toLowerCase().trim();
    const user = await User.create({
      name: String(name).trim(),
      email: emailNorm,
      passwordHash,
    });

    const token = signUserToken(user._id);
    res.status(201).json({ token, user: userResponse(user) });
  } catch (e) {
    next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });

    const invalid = () =>
      res.status(401).json({ field: "password", message: "Incorrect email or password." });

    if (!user) return invalid();
    if (!user.passwordHash) {
      return res.status(401).json({
        field: "password",
        message: "This account has no password set.",
      });
    }

    const match = await bcrypt.compare(String(password), user.passwordHash);
    if (!match) return invalid();

    const token = signUserToken(user._id);
    res.json({ token, user: userResponse(user) });
  } catch (e) {
    next(e);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).lean();
    if (!user) return res.status(401).json({ message: "User not found" });
    res.json(userResponse(user));
  } catch (e) {
    next(e);
  }
});

export default router;
