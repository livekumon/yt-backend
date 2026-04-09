import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createOrder,
  captureOrder,
  getPaymentHistory,
  getPaymentById,
  getTokenPacks,
  getRazorpayKeyId,
  createRazorpayOrder,
  verifyRazorpayPayment,
} from "../controllers/paymentController.js";

const router = Router();

router.get("/token-packs", getTokenPacks);
router.get("/razorpay/key-id", getRazorpayKeyId);

router.use(requireAuth);

router.post("/create-order", createOrder);
router.post("/capture-order", captureOrder);

router.post("/razorpay/create-order", createRazorpayOrder);
router.post("/razorpay/verify", verifyRazorpayPayment);

router.get("/history", getPaymentHistory);
router.get("/:id", getPaymentById);

export default router;
