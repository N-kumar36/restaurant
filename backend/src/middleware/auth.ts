import { Request, Response, NextFunction } from "express";
import { verifyToken, TokenPayload } from "../utils/jwt.js";
import { prisma } from "../config/db.js";
import { UserRole } from "@prisma/client";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    restaurantIds: string[];
  };
}

export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let token = "";
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }

    if (!token) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        memberships: true,
      },
    });

    if (!user) {
      res.status(401).json({ success: false, message: "User not found or deactivated" });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      restaurantIds: user.memberships.map((m) => m.restaurantId),
    };

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    if (req.user.role === UserRole.SUPER_ADMIN || allowedRoles.includes(req.user.role)) {
      next();
      return;
    }

    res.status(403).json({ success: false, message: "Access forbidden: insufficient role permissions" });
  };
}

export async function verifyRestaurantAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }

  // Super admins have access to all restaurants
  if (req.user.role === UserRole.SUPER_ADMIN) {
    next();
    return;
  }

  const restaurantId = (req.params.restaurantId || req.query.restaurantId || req.body.restaurantId) as string;

  if (restaurantId && !req.user.restaurantIds.includes(restaurantId)) {
    res.status(403).json({ success: false, message: "Access forbidden: you do not have permission for this restaurant" });
    return;
  }

  next();
}

