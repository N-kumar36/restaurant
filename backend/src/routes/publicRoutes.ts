import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/db.js";

const router = Router();

// GET /api/restaurants/:slug
router.get("/restaurants/:slug", async (req: Request, res: Response, next) => {
  try {
    const { slug } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      include: {
        settings: true,
        images: {
          orderBy: { displayOrder: "asc" },
        },
        reviews: {
          where: { isApproved: true },
          orderBy: { createdAt: "desc" },
          take: 6,
        },
      },
    });

    if (!restaurant) {
      res.status(404).json({ success: false, message: "Restaurant not found" });
      return;
    }

    // Compute average rating
    const aggregate = await prisma.review.aggregate({
      where: { restaurantId: restaurant.id, isApproved: true },
      _avg: { rating: true },
      _count: { rating: true },
    });

    res.json({
      success: true,
      restaurant: {
        ...restaurant,
        averageRating: aggregate._avg.rating ? Math.round(aggregate._avg.rating * 10) / 10 : 4.9,
        totalReviews: aggregate._count.rating || 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/restaurants/:slug/menu
router.get("/restaurants/:slug/menu", async (req: Request, res: Response, next) => {
  try {
    const { slug } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, currency: true, isOpen: true },
    });

    if (!restaurant) {
      res.status(404).json({ success: false, message: "Restaurant not found" });
      return;
    }

    const categories = await prisma.menuCategory.findMany({
      where: {
        restaurantId: restaurant.id,
        isActive: true,
      },
      orderBy: { displayOrder: "asc" },
      include: {
        items: {
          where: {
            isAvailable: true,
          },
          orderBy: { displayOrder: "asc" },
          include: {
            variants: {
              where: { isAvailable: true },
              orderBy: { displayOrder: "asc" },
            },
            addons: {
              where: { isAvailable: true },
              orderBy: { displayOrder: "asc" },
            },
          },
        },
      },
    });

    // Parse dietary badges and allergens JSON
    const parsedCategories = categories.map((cat) => ({
      ...cat,
      items: cat.items.map((item) => ({
        ...item,
        dietaryBadges: item.dietaryBadgesJson ? JSON.parse(item.dietaryBadgesJson) : [],
        allergens: item.allergensJson ? JSON.parse(item.allergensJson) : [],
      })),
    }));

    res.json({
      success: true,
      restaurant,
      categories: parsedCategories,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/restaurants/:slug/categories
router.get("/restaurants/:slug/categories", async (req: Request, res: Response, next) => {
  try {
    const { slug } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!restaurant) {
      res.status(404).json({ success: false, message: "Restaurant not found" });
      return;
    }

    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId: restaurant.id, isActive: true },
      orderBy: { displayOrder: "asc" },
    });

    res.json({ success: true, categories });
  } catch (error) {
    next(error);
  }
});

// GET /api/restaurants/:slug/tables/:tableNumber/validate
router.get("/restaurants/:slug/tables/:tableNumber/validate", async (req: Request, res: Response, next) => {
  try {
    const { slug, tableNumber } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, name: true, isOpen: true },
    });

    if (!restaurant) {
      res.status(404).json({ success: false, message: "Restaurant not found" });
      return;
    }

    const table = await prisma.table.findFirst({
      where: {
        restaurantId: restaurant.id,
        tableNumber: {
          equals: tableNumber,
        },
        isActive: true,
      },
    });

    if (!table) {
      res.status(404).json({
        success: false,
        valid: false,
        message: `Table "${tableNumber}" is invalid, inactive, or does not exist for ${restaurant.name}`,
      });
      return;
    }

    res.json({
      success: true,
      valid: true,
      table: {
        id: table.id,
        tableNumber: table.tableNumber,
        capacity: table.capacity,
      },
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        isOpen: restaurant.isOpen,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/restaurants/:slug/reviews
router.get("/restaurants/:slug/reviews", async (req: Request, res: Response, next) => {
  try {
    const { slug } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!restaurant) {
      res.status(404).json({ success: false, message: "Restaurant not found" });
      return;
    }

    const reviews = await prisma.review.findMany({
      where: { restaurantId: restaurant.id, isApproved: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, reviews });
  } catch (error) {
    next(error);
  }
});

// POST /api/restaurants/:slug/reviews
const reviewSchema = z.object({
  customerName: z.string().min(2, "Name must be at least 2 characters"),
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(5, "Comment must be at least 5 characters"),
});

router.post("/restaurants/:slug/reviews", async (req: Request, res: Response, next) => {
  try {
    const { slug } = req.params;
    const { customerName, rating, comment } = reviewSchema.parse(req.body);

    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!restaurant) {
      res.status(404).json({ success: false, message: "Restaurant not found" });
      return;
    }

    const review = await prisma.review.create({
      data: {
        restaurantId: restaurant.id,
        customerName,
        rating,
        comment,
        isApproved: true,
      },
    });

    res.status(201).json({ success: true, message: "Review submitted successfully", review });
  } catch (error) {
    next(error);
  }
});

export default router;

