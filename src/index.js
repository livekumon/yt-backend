import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDb } from "./config/db.js";
import authRouter from "./routes/auth.js";
import paymentsRouter from "./routes/payments.js";
import adminRouter from "./routes/admin.js";

const PORT = Number(process.env.PORT) || 8080;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/youtube-downloader";

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : [
      "http://localhost:1420",
      "http://127.0.0.1:1420",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5175",
      "http://127.0.0.1:5175",
      "tauri://localhost",
    ];

const app = express();

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      if (!process.env.VERCEL && origin) {
        try {
          const { hostname } = new URL(origin);
          if (hostname === "localhost" || hostname === "127.0.0.1") {
            return cb(null, true);
          }
        } catch {
          /* ignore */
        }
      }
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

app.use(express.json());

app.use(async (_req, _res, next) => {
  try {
    await connectDb(MONGODB_URI);
    next();
  } catch (e) {
    next(e);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "youtube-downloader-api" });
});

app.get("/api/paypal/client-id", (_req, res) => {
  res.json({ clientId: process.env.PAYPAL_CLIENT_ID || "" });
});

app.use("/api/auth", authRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.message?.startsWith("CORS:") ? 403 : 500;
  res.status(status).json({ message: err.message || "Server error" });
});

if (!process.env.VERCEL) {
  connectDb(MONGODB_URI)
    .then(() => {
      app.listen(PORT, "0.0.0.0", () =>
        console.log(`API listening on 0.0.0.0:${PORT}`)
      );
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

export default app;
