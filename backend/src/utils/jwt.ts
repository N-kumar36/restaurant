import jwt from "jsonwebtoken";
import { ENV } from "../config/env.js";

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  restaurantId?: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, ENV.JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as TokenPayload;
}

