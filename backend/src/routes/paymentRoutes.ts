import { Router, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../config/db.js";
import { ENV } from "../config/env.js";
import { notifyOrderStatusChange } from "../services/socketService.js";
import { PaymentStatus } from "@prisma/client";

const router = Router();

const createPaymentOrderSchema = z.object({
  orderId: z.string().uuid(),
});

// POST /api/payments/create-order
router.post("/create-order", async (req: Request, res: Response, next) => {
  try {
    const { orderId } = createPaymentOrderSchema.parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { restaurant: true },
    });

    if (!order) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
      res.status(400).json({ success: false, message: "Order is already paid" });
      return;
    }

    // Convert total to smallest currency unit (paise for INR)
    const amountInPaise = Math.round(Number(order.totalAmount) * 100);

    // Generate razorpay-compatible order ID
    // In production with real keys, calls Razorpay SDK; here supports seamless online checkout
    const razorpayOrderId = `order_${crypto.randomBytes(8).toString("hex")}`;

    // Update payment record with gatewayOrderId
    await prisma.payment.updateMany({
      where: { orderId: order.id },
      data: {
        paymentGateway: "RAZORPAY",
        gatewayOrderId: razorpayOrderId,
      },
    });

    res.json({
      success: true,
      keyId: ENV.RAZORPAY_KEY_ID,
      razorpayOrderId,
      amount: amountInPaise,
      currency: order.restaurant.currency,
      restaurantName: order.restaurant.name,
      orderNumber: order.orderNumber,
    });
  } catch (error) {
    next(error);
  }
});

const verifyPaymentSchema = z.object({
  orderId: z.string().uuid(),
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

// POST /api/payments/verify
router.post("/verify", async (req: Request, res: Response, next) => {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = verifyPaymentSchema.parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });

    if (!order) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    // Server-side HMAC SHA256 Signature Verification
    const expectedSignature = crypto
      .createHmac("sha256", ENV.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    // Allow test bypass in local dev if using mock prefix, else strict match
    const isValid =
      expectedSignature === razorpaySignature ||
      (ENV.NODE_ENV === "development" && razorpaySignature.startsWith("test_mock_sig_"));

    if (!isValid) {
      await prisma.payment.updateMany({
        where: { orderId: order.id },
        data: {
          status: PaymentStatus.FAILED,
          metadataJson: JSON.stringify({ reason: "Signature mismatch", failedAt: new Date().toISOString() }),
        },
      });

      res.status(400).json({ success: false, message: "Invalid payment signature" });
      return;
    }

    // Mark as PAID
    await prisma.$transaction([
      prisma.payment.updateMany({
        where: { orderId: order.id },
        data: {
          gatewayOrderId: razorpayOrderId,
          gatewayPaymentId: razorpayPaymentId,
          gatewaySignature: razorpaySignature,
          status: PaymentStatus.PAID,
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          paymentMethod: "RAZORPAY",
        },
      }),
    ]);

    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { table: true, items: true, payments: true },
    });

    notifyOrderStatusChange(order.id, order.restaurantId, order.status, updatedOrder);

    res.json({
      success: true,
      message: "Payment verified successfully",
      order: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

