import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../config/db.js";
import { signToken } from "../utils/jwt.js";
import { authenticateToken, AuthenticatedRequest } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { ENV } from "../config/env.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// POST /api/auth/login
router.post("/login", authLimiter, async (req: Request, res: Response, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        memberships: {
          include: {
            restaurant: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      res.status(401).json({ success: false, message: "Invalid credentials" });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ success: false, message: "Invalid credentials" });
      return;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      restaurantId: user.memberships[0]?.restaurantId,
    });

    // Set secure HTTP-only cookie
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: ENV.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        restaurants: user.memberships.map((m) => ({
          id: m.restaurant.id,
          name: m.restaurant.name,
          slug: m.restaurant.slug,
          role: m.role,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
router.post("/logout", (req: Request, res: Response) => {
  res.clearCookie("auth_token");
  res.json({ success: true, message: "Logged out successfully" });
});

// GET /api/auth/me
router.get("/me", authenticateToken, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        memberships: {
          include: {
            restaurant: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        restaurants: user.memberships.map((m) => ({
          id: m.restaurant.id,
          name: m.restaurant.name,
          slug: m.restaurant.slug,
          logoUrl: m.restaurant.logoUrl,
          role: m.role,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

