# YouTube Downloader API

Express API for email login and PayPal / Razorpay payments, deployable on Vercel.

## Local development

1. Copy `.env.example` to `.env` and set `MONGODB_URI`, `JWT_SECRET`, PayPal and Razorpay keys, and `CORS_ORIGINS` (include Tauri `http://localhost:1420` and **YTCRM** `http://localhost:5175` when using the CRM locally).
2. Set **`ADMIN_EMAIL`** and **`ADMIN_PASSWORD`** for the **YTCRM** admin UI (`/api/admin/*`).
3. `npm install` and `npm run dev` (or `node src/index.js`).

## Vercel

1. Create a Vercel project with **root directory** set to this `backend` folder (or import the monorepo and set the root to `backend`).
2. Add the same environment variables as in `.env.example`.
3. Set `CORS_ORIGINS` to your production frontend origin(s), comma-separated.
4. Deploy; the app exposes `GET /api/health` for checks.

`vercel.json` routes all traffic to `src/index.js` using `@vercel/node`.
