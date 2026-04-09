import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      throw new Error("JWT_SECRET is required in production");
    }
    return "dev-insecure-jwt-secret-change-me";
  }
  return s;
}

export function signUserToken(userId) {
  return jwt.sign({ sub: String(userId) }, getSecret(), { expiresIn: "7d" });
}

/** Root operator session for CRM — not tied to a User document */
export function signAdminToken() {
  return jwt.sign({ role: "admin", sub: "admin" }, getSecret(), { expiresIn: "1d" });
}

export function requireAdminAccess(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const decoded = jwt.verify(auth.slice(7), getSecret());
    if (decoded?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired admin session" });
  }
}

export function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const decoded = jwt.verify(auth.slice(7), getSecret());
    if (!decoded?.sub) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.userId = decoded.sub;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
