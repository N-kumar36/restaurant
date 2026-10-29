import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/db.js";
import { calculateOrderTotals, toCents } from "../utils/calc.js";
import { notifyNewOrder, notifyOrderStatusChange } from "../services/socketService.js";
import { orderLimiter } from "../middleware/rateLimiter.js";
import { OrderStatus, OrderType, PaymentMethod, PaymentStatus } from "@prisma/client";

const router = Router();

const orderItemAddonSchema = z.object({
  addonId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
});

const orderItemInputSchema = z.object({
  menuItemId: z.string().uuid(),
  variantId: z.string().uuid().optional().nullable(),
  addons: z.array(orderItemAddonSchema).optional().default([]),
  quantity: z.number().int().min(1).max(50),
  notes: z.string().max(200).optional(),
});

const createOrderSchema = z.object({
  restaurantSlug: z.string().min(1),
  tableNumber: z.string().optional().nullable(),
  customerName: z.string().min(2, "Customer name must be at least 2 characters"),
  customerPhone: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().nullable(),
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]).default("DINE_IN"),
  paymentMethod: z.enum(["CASH", "RAZORPAY", "CARD"]).default("CASH"),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().min(8).optional().nullable(),
  items: z.array(orderItemInputSchema).min(1, "At least one item is required in the cart"),
});

// POST /api/orders - Customer places an order
router.post("/orders", orderLimiter, async (req: Request, res: Response, next) => {
  try {
    const input = createOrderSchema.parse(req.body);

    // 1. Check idempotency if key is present
    if (input.idempotencyKey) {
      const existingOrder = await prisma.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: {
          items: {
            include: { addons: true },
          },
          table: true,
          payments: true,
        },
      });

      if (existingOrder) {
        res.status(200).json({
          success: true,
          message: "Order already processed (idempotent replay)",
          order: existingOrder,
        });
        return;
      }
    }

    // 2. Fetch Restaurant and verify it is open
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug: input.restaurantSlug },
      include: {
        settings: true,
      },
    });

    if (!restaurant) {
      res.status(404).json({ success: false, message: "Restaurant not found" });
      return;
    }

    if (!restaurant.isOpen) {
      res.status(400).json({ success: false, message: "Restaurant is currently closed for orders." });
      return;
    }

    // 3. Verify Table if Dine-In
    let verifiedTableId: string | null = null;
    if (input.orderType === "DINE_IN" && input.tableNumber) {
      const table = await prisma.table.findFirst({
        where: {
          restaurantId: restaurant.id,
          tableNumber: input.tableNumber,
          isActive: true,
        },
      });

      if (!table) {
        res.status(400).json({
          success: false,
          message: `Table "${input.tableNumber}" is invalid or inactive. Please scan a valid table QR code.`,
        });
        return;
      }

      verifiedTableId = table.id;
    }

    // 4. Authoritative server-side price calculation and item validation
    const itemIds = input.items.map((i) => i.menuItemId);
    const dbMenuItems = await prisma.menuItem.findMany({
      where: {
        id: { in: itemIds },
        restaurantId: restaurant.id,
      },
      include: {
        variants: true,
        addons: true,
      },
    });

    const itemMap = new Map(dbMenuItems.map((item) => [item.id, item]));

    let calculatedItemsSubtotalCents = 0;
    const preparedOrderItems: Array<{
      menuItemId: string;
      itemNameSnapshot: string;
      unitPriceSnapshot: number;
      quantity: number;
      totalPriceSnapshot: number;
      variantNameSnapshot?: string;
      notes?: string;
      addons: Array<{
        addonNameSnapshot: string;
        priceSnapshot: number;
        quantity: number;
      }>;
    }> = [];

    for (const reqItem of input.items) {
      const menuItem = itemMap.get(reqItem.menuItemId);
      if (!menuItem) {
        res.status(400).json({
          success: false,
          message: `Item not found in menu for this restaurant.`,
        });
        return;
      }

      if (!menuItem.isAvailable) {
        res.status(400).json({
          success: false,
          message: `Dish "${menuItem.name}" is currently sold out. Please remove it to proceed.`,
        });
        return;
      }

      let unitPriceCents = toCents(Number(menuItem.basePrice));
      let variantName: string | undefined = undefined;

      if (reqItem.variantId) {
        const variant = menuItem.variants.find((v) => v.id === reqItem.variantId);
        if (!variant || !variant.isAvailable) {
          res.status(400).json({
            success: false,
            message: `Selected variant for "${menuItem.name}" is unavailable.`,
          });
          return;
        }
        unitPriceCents = toCents(Number(variant.price));
        variantName = variant.name;
      }

      let itemTotalCents = unitPriceCents * reqItem.quantity;
      const preparedAddons: Array<{ addonNameSnapshot: string; priceSnapshot: number; quantity: number }> = [];

      if (reqItem.addons && reqItem.addons.length > 0) {
        for (const reqAddon of reqItem.addons) {
          const addon = menuItem.addons.find((a) => a.id === reqAddon.addonId);
          if (!addon || !addon.isAvailable) {
            res.status(400).json({
              success: false,
              message: `Addon for "${menuItem.name}" is unavailable.`,
            });
            return;
          }

          const addonPriceCents = toCents(Number(addon.price));
          itemTotalCents += addonPriceCents * reqAddon.quantity * reqItem.quantity;

          preparedAddons.push({
            addonNameSnapshot: addon.name,
            priceSnapshot: Number(addon.price),
            quantity: reqAddon.quantity,
          });
        }
      }

      calculatedItemsSubtotalCents += itemTotalCents;

      preparedOrderItems.push({
        menuItemId: menuItem.id,
        itemNameSnapshot: menuItem.name,
        unitPriceSnapshot: unitPriceCents / 100,
        quantity: reqItem.quantity,
        totalPriceSnapshot: itemTotalCents / 100,
        variantNameSnapshot: variantName,
        notes: reqItem.notes,
        addons: preparedAddons,
      });
    }

    // 5. Calculate taxes and grand total safely
    const taxRate = Number(restaurant.taxRate) || 0;
    const serviceRate = Number(restaurant.serviceChargeRate) || 0;
    const totals = calculateOrderTotals(calculatedItemsSubtotalCents, taxRate, serviceRate);

    // Verify minimum order amount if set
    if (restaurant.settings?.minimumOrderAmount && totals.subtotal < Number(restaurant.settings.minimumOrderAmount)) {
      res.status(400).json({
        success: false,
        message: `Minimum subtotal for order is ${restaurant.currency} ${restaurant.settings.minimumOrderAmount}`,
      });
      return;
    }

    // 6. Generate readable Order Number (e.g., ORD-2026-XXXX)
    const datePrefix = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `ORD-${datePrefix}-${randomSuffix}`;

    // Auto accept if setting enabled
    const initialStatus = restaurant.settings?.autoAcceptOrders ? OrderStatus.ACCEPTED : OrderStatus.PENDING;

    // 7. Execute transactional database insert
    const createdOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber,
          restaurantId: restaurant.id,
          tableId: verifiedTableId,
          customerName: input.customerName.trim(),
          customerPhone: input.customerPhone?.trim() || null,
          customerEmail: input.customerEmail?.trim() || null,
          orderType: input.orderType as OrderType,
          status: initialStatus,
          paymentStatus: PaymentStatus.PENDING,
          paymentMethod: input.paymentMethod as PaymentMethod,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          serviceCharge: totals.serviceCharge,
          totalAmount: totals.totalAmount,
          notes: input.notes?.trim() || null,
          idempotencyKey: input.idempotencyKey || null,
          estimatedPrepMinutes: restaurant.prepTimeMinutes || 20,
        },
      });

      for (const pItem of preparedOrderItems) {
        const itemRecord = await tx.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: pItem.menuItemId,
            itemNameSnapshot: pItem.itemNameSnapshot,
            unitPriceSnapshot: pItem.unitPriceSnapshot,
            quantity: pItem.quantity,
            totalPriceSnapshot: pItem.totalPriceSnapshot,
            variantNameSnapshot: pItem.variantNameSnapshot,
            notes: pItem.notes,
          },
        });

        if (pItem.addons.length > 0) {
          for (const addon of pItem.addons) {
            await tx.orderItemAddon.create({
              data: {
                orderItemId: itemRecord.id,
                addonNameSnapshot: addon.addonNameSnapshot,
                priceSnapshot: addon.priceSnapshot,
                quantity: addon.quantity,
              },
            });
          }
        }
      }

      // Initial payment record
      await tx.payment.create({
        data: {
          orderId: order.id,
          paymentGateway: input.paymentMethod,
          amount: totals.totalAmount,
          currency: restaurant.currency,
          status: PaymentStatus.PENDING,
        },
      });

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          table: true,
          restaurant: {
            select: { name: true, slug: true, phone: true, currency: true },
          },
          items: {
            include: { addons: true },
          },
          payments: true,
        },
      });
    });

    // 8. Real-time notification to Kitchen/Admin Dashboard
    notifyNewOrder(restaurant.id, createdOrder);

    res.status(201).json({
      success: true,
      message: "Order placed successfully!",
      order: createdOrder,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/orders/:orderId - Customer order status & details
router.get("/orders/:orderId", async (req: Request, res: Response, next) => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
      include: {
        restaurant: {
          select: {
            id: true,
            name: true,
            slug: true,
            phone: true,
            address: true,
            currency: true,
          },
        },
        table: {
          select: {
            id: true,
            tableNumber: true,
          },
        },
        items: {
          include: {
            addons: true,
          },
        },
        payments: true,
      },
    });

    if (!order) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    res.json({
      success: true,
      order,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/orders/:orderId/cancel - Customer can cancel only if status is PENDING
router.post("/orders/:orderId/cancel", async (req: Request, res: Response, next) => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
    });

    if (!order) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    if (order.status !== OrderStatus.PENDING) {
      res.status(400).json({
        success: false,
        message: `Order cannot be cancelled because it is already ${order.status.toLowerCase()}. Please speak to our staff.`,
      });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELLED,
      },
      include: {
        table: true,
        items: true,
      },
    });

    // Notify kitchen and customer
    notifyOrderStatusChange(order.id, order.restaurantId, OrderStatus.CANCELLED, updated);

    res.json({
      success: true,
      message: "Order cancelled successfully.",
      order: updated,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

