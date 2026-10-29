import { Router, Response } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "../config/db.js";
import { authenticateToken, AuthenticatedRequest, requireRole } from "../middleware/auth.js";
import { notifyOrderStatusChange } from "../services/socketService.js";
import { OrderStatus, UserRole } from "@prisma/client";

const router = Router();

// Protect all admin routes
router.use(authenticateToken);

// Helper to get authorized restaurant ID
function getRestaurantId(req: AuthenticatedRequest): string {
  const queryId = req.query.restaurantId as string;
  if (queryId && (req.user?.role === UserRole.SUPER_ADMIN || req.user?.restaurantIds.includes(queryId))) {
    return queryId;
  }
  if (req.user?.restaurantIds && req.user.restaurantIds.length > 0) {
    return req.user.restaurantIds[0];
  }
  throw new Error("No authorized restaurant found for user");
}

// -------------------------------------------------------------
// 1. DASHBOARD STATS
// -------------------------------------------------------------
router.get("/dashboard-stats", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);

    // Get today's start and end timestamps
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      todayOrders,
      pendingCount,
      preparingCount,
      readyCount,
      recentOrders,
      popularItemsGroup,
      restaurantInfo,
    ] = await Promise.all([
      prisma.order.findMany({
        where: {
          restaurantId,
          createdAt: { gte: startOfToday },
          status: { not: OrderStatus.CANCELLED },
        },
        select: {
          totalAmount: true,
          status: true,
        },
      }),
      prisma.order.count({
        where: { restaurantId, status: OrderStatus.PENDING },
      }),
      prisma.order.count({
        where: { restaurantId, status: OrderStatus.PREPARING },
      }),
      prisma.order.count({
        where: { restaurantId, status: OrderStatus.READY },
      }),
      prisma.order.findMany({
        where: { restaurantId },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          table: true,
          items: true,
        },
      }),
      prisma.orderItem.groupBy({
        by: ["itemNameSnapshot"],
        where: {
          order: {
            restaurantId,
            status: { not: OrderStatus.CANCELLED },
          },
        },
        _sum: { quantity: true, totalPriceSnapshot: true },
        orderBy: {
          _sum: { quantity: "desc" },
        },
        take: 5,
      }),
      prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { name: true, slug: true, currency: true, isOpen: true },
      }),
    ]);

    const todayOrderCount = todayOrders.length;
    const todaySales = todayOrders.reduce((acc, curr) => acc + Number(curr.totalAmount), 0);

    const popularItems = popularItemsGroup.map((item) => ({
      name: item.itemNameSnapshot,
      count: item._sum.quantity || 0,
      totalSales: Number(item._sum.totalPriceSnapshot || 0),
    }));

    res.json({
      success: true,
      restaurant: restaurantInfo,
      stats: {
        todayOrderCount,
        todaySales: Math.round(todaySales * 100) / 100,
        pendingCount,
        preparingCount,
        readyCount,
        popularItems,
        recentOrders,
      },
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 2. ORDER MANAGEMENT & STATUS TRANSITIONS
// -------------------------------------------------------------
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
  [OrderStatus.READY]: [OrderStatus.SERVED, OrderStatus.COMPLETED],
  [OrderStatus.SERVED]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

// GET /api/admin/orders
router.get("/orders", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const { status, limit = "50", offset = "0" } = req.query;

    const whereClause: any = { restaurantId };
    if (status && status !== "ALL") {
      whereClause.status = status as OrderStatus;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip: parseInt(offset as string, 10),
        take: parseInt(limit as string, 10),
        include: {
          table: true,
          items: {
            include: { addons: true },
          },
          payments: true,
        },
      }),
      prisma.order.count({ where: whereClause }),
    ]);

    res.json({ success: true, orders, total });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/orders/:orderId/status
const updateStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
});

router.patch("/orders/:orderId/status", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { orderId } = req.params;
    const { status: nextStatus } = updateStatusSchema.parse(req.body);
    const restaurantId = getRestaurantId(req);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { table: true, items: true },
    });

    if (!order || order.restaurantId !== restaurantId) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    // Enforce valid status transitions
    const allowedNext = VALID_TRANSITIONS[order.status];
    if (!allowedNext.includes(nextStatus)) {
      res.status(400).json({
        success: false,
        message: `Invalid status transition from ${order.status} to ${nextStatus}. Allowed: ${allowedNext.join(", ")}`,
      });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: nextStatus },
      include: {
        table: true,
        items: { include: { addons: true } },
        payments: true,
      },
    });

    // Real-time broadcast to kitchen and customer
    notifyOrderStatusChange(order.id, restaurantId, nextStatus, updated);

    res.json({
      success: true,
      message: `Order status updated to ${nextStatus}`,
      order: updated,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 3. MENU CATEGORIES MANAGEMENT
// -------------------------------------------------------------
router.get("/categories", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId },
      orderBy: { displayOrder: "asc" },
      include: {
        _count: { select: { items: true } },
      },
    });
    res.json({ success: true, categories });
  } catch (error) {
    next(error);
  }
});

const categorySchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  description: z.string().optional(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

router.post("/categories", requireRole([UserRole.OWNER, UserRole.MANAGER]), async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const data = categorySchema.parse(req.body);

    const category = await prisma.menuCategory.create({
      data: {
        ...data,
        restaurantId,
      },
    });

    res.status(201).json({ success: true, category });
  } catch (error) {
    next(error);
  }
});

router.patch("/categories/:id", requireRole([UserRole.OWNER, UserRole.MANAGER]), async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const restaurantId = getRestaurantId(req);
    const data = categorySchema.partial().parse(req.body);

    const updated = await prisma.menuCategory.update({
      where: { id, restaurantId },
      data,
    });

    res.json({ success: true, category: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/categories/:id", requireRole([UserRole.OWNER, UserRole.MANAGER]), async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const restaurantId = getRestaurantId(req);

    await prisma.menuCategory.delete({
      where: { id, restaurantId },
    });

    res.json({ success: true, message: "Category deleted" });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 4. MENU ITEMS MANAGEMENT
// -------------------------------------------------------------
router.get("/menu-items", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const items = await prisma.menuItem.findMany({
      where: { restaurantId },
      orderBy: [{ categoryId: "asc" }, { displayOrder: "asc" }],
      include: {
        category: { select: { id: true, name: true } },
        variants: true,
        addons: true,
      },
    });

    const parsed = items.map((i) => ({
      ...i,
      dietaryBadges: i.dietaryBadgesJson ? JSON.parse(i.dietaryBadgesJson) : [],
      allergens: i.allergensJson ? JSON.parse(i.allergensJson) : [],
    }));

    res.json({ success: true, items: parsed });
  } catch (error) {
    next(error);
  }
});

const menuItemSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(2),
  slug: z.string().min(2),
  description: z.string().optional(),
  basePrice: z.number().positive(),
  imageUrl: z.string().optional(),
  isVeg: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  spiceLevel: z.number().int().min(0).max(5).default(1),
  prepTimeMinutes: z.number().int().min(1).default(15),
  dietaryBadges: z.array(z.string()).default([]),
  allergens: z.array(z.string()).default([]),
  displayOrder: z.number().int().default(0),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        price: z.number().positive(),
        isDefault: z.boolean().default(false),
      })
    )
    .optional(),
  addons: z
    .array(
      z.object({
        name: z.string().min(1),
        price: z.number().positive(),
      })
    )
    .optional(),
});

router.post("/menu-items", requireRole([UserRole.OWNER, UserRole.MANAGER]), async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const data = menuItemSchema.parse(req.body);

    const created = await prisma.menuItem.create({
      data: {
        restaurantId,
        categoryId: data.categoryId,
        name: data.name,
        slug: data.slug,
        description: data.description || null,
        basePrice: data.basePrice,
        imageUrl: data.imageUrl || null,
        isVeg: data.isVeg,
        isAvailable: data.isAvailable,
        isFeatured: data.isFeatured,
        spiceLevel: data.spiceLevel,
        prepTimeMinutes: data.prepTimeMinutes,
        dietaryBadgesJson: JSON.stringify(data.dietaryBadges),
        allergensJson: JSON.stringify(data.allergens),
        displayOrder: data.displayOrder,
        variants: data.variants
          ? {
              create: data.variants.map((v, idx) => ({
                name: v.name,
                price: v.price,
                isDefault: v.isDefault,
                displayOrder: idx + 1,
              })),
            }
          : undefined,
        addons: data.addons
          ? {
              create: data.addons.map((a, idx) => ({
                name: a.name,
                price: a.price,
                displayOrder: idx + 1,
              })),
            }
          : undefined,
      },
      include: {
        variants: true,
        addons: true,
        category: true,
      },
    });

    res.status(201).json({ success: true, item: created });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/menu-items/:id/toggle-availability
router.patch("/menu-items/:id/toggle-availability", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const restaurantId = getRestaurantId(req);

    const existing = await prisma.menuItem.findUnique({
      where: { id, restaurantId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Menu item not found" });
      return;
    }

    const updated = await prisma.menuItem.update({
      where: { id },
      data: { isAvailable: !existing.isAvailable },
    });

    res.json({
      success: true,
      message: `Dish "${updated.name}" is now ${updated.isAvailable ? "available" : "sold out"}`,
      item: updated,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 5. TABLE & QR MANAGEMENT
// -------------------------------------------------------------
router.get("/tables", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const tables = await prisma.table.findMany({
      where: { restaurantId },
      orderBy: { tableNumber: "asc" },
    });
    res.json({ success: true, tables });
  } catch (error) {
    next(error);
  }
});

const createTableSchema = z.object({
  tableNumber: z.string().min(1),
  capacity: z.number().int().min(1).default(4),
});

router.post("/tables", requireRole([UserRole.OWNER, UserRole.MANAGER]), async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const { tableNumber, capacity } = createTableSchema.parse(req.body);

    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { slug: true },
    });

    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
    const qrTargetUrl = `${clientUrl}/menu/${restaurant.slug}?table=${encodeURIComponent(tableNumber)}`;

    const qrDataUrl = await QRCode.toDataURL(qrTargetUrl, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 400,
      color: { dark: "#1c1917", light: "#ffffff" },
    });

    const table = await prisma.table.create({
      data: {
        restaurantId,
        tableNumber,
        capacity,
        qrCodeUrl: qrDataUrl,
        isActive: true,
      },
    });

    res.status(201).json({ success: true, table });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/tables/:id/regenerate-qr
router.post("/tables/:id/regenerate-qr", requireRole([UserRole.OWNER, UserRole.MANAGER]), async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const restaurantId = getRestaurantId(req);

    const table = await prisma.table.findUnique({
      where: { id, restaurantId },
      include: { restaurant: { select: { slug: true } } },
    });

    if (!table) {
      res.status(404).json({ success: false, message: "Table not found" });
      return;
    }

    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
    const qrTargetUrl = `${clientUrl}/menu/${table.restaurant.slug}?table=${encodeURIComponent(table.tableNumber)}`;

    const qrDataUrl = await QRCode.toDataURL(qrTargetUrl, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 400,
      color: { dark: "#1c1917", light: "#ffffff" },
    });

    const updated = await prisma.table.update({
      where: { id },
      data: { qrCodeUrl: qrDataUrl },
    });

    res.json({ success: true, table: updated });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 6. RESTAURANT SETTINGS & INFO
// -------------------------------------------------------------
router.get("/settings", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: { settings: true },
    });
    res.json({ success: true, restaurant });
  } catch (error) {
    next(error);
  }
});

const updateSettingsSchema = z.object({
  name: z.string().optional(),
  tagline: z.string().optional(),
  description: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  isOpen: z.boolean().optional(),
  taxRate: z.number().optional(),
  serviceChargeRate: z.number().optional(),
  prepTimeMinutes: z.number().optional(),
  allowDineIn: z.boolean().optional(),
  allowTakeaway: z.boolean().optional(),
  allowOnlinePayment: z.boolean().optional(),
  allowPayAtCounter: z.boolean().optional(),
  autoAcceptOrders: z.boolean().optional(),
  minimumOrderAmount: z.number().optional(),
});

router.patch("/settings", requireRole([UserRole.OWNER]), async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const data = updateSettingsSchema.parse(req.body);

    const {
      allowDineIn,
      allowTakeaway,
      allowOnlinePayment,
      allowPayAtCounter,
      autoAcceptOrders,
      minimumOrderAmount,
      ...restaurantFields
    } = data;

    const [updatedRestaurant] = await prisma.$transaction([
      prisma.restaurant.update({
        where: { id: restaurantId },
        data: restaurantFields,
      }),
      prisma.restaurantSettings.upsert({
        where: { restaurantId },
        update: {
          allowDineIn,
          allowTakeaway,
          allowOnlinePayment,
          allowPayAtCounter,
          autoAcceptOrders,
          minimumOrderAmount,
        },
        create: {
          restaurantId,
          allowDineIn: allowDineIn ?? true,
          allowTakeaway: allowTakeaway ?? true,
          allowOnlinePayment: allowOnlinePayment ?? true,
          allowPayAtCounter: allowPayAtCounter ?? true,
          autoAcceptOrders: autoAcceptOrders ?? false,
          minimumOrderAmount: minimumOrderAmount ?? 0,
        },
      }),
    ]);

    res.json({ success: true, message: "Settings updated successfully", restaurant: updatedRestaurant });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 7. REPORTS & CSV EXPORT
// -------------------------------------------------------------
router.get("/reports/sales", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const { days = "7" } = req.query;
    const numDays = parseInt(days as string, 10);

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - numDays);

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        createdAt: { gte: sinceDate },
        status: { not: OrderStatus.CANCELLED },
      },
      select: {
        totalAmount: true,
        createdAt: true,
        status: true,
        orderType: true,
      },
    });

    const statusCounts = await prisma.order.groupBy({
      by: ["status"],
      where: { restaurantId, createdAt: { gte: sinceDate } },
      _count: { status: true },
    });

    res.json({
      success: true,
      orders,
      statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count.status })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/reports/export-csv
router.get("/reports/export-csv", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const restaurantId = getRestaurantId(req);
    const orders = await prisma.order.findMany({
      where: { restaurantId },
      orderBy: { createdAt: "desc" },
      include: { table: true },
    });

    let csv = "Order Number,Date,Customer Name,Phone,Table,Type,Status,Payment Method,Payment Status,Total Amount\n";
    for (const o of orders) {
      const date = o.createdAt.toISOString();
      const table = o.table ? o.table.tableNumber : "N/A";
      csv += `"${o.orderNumber}","${date}","${o.customerName}","${o.customerPhone || ""}","${table}","${o.orderType}","${o.status}","${o.paymentMethod}","${o.paymentStatus}",${o.totalAmount}\n`;
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=orders-export-${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

export default router;

