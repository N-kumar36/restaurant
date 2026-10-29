import dotenv from "dotenv";
dotenv.config();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "5000", 10),
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:3000",
  JWT_SECRET: process.env.JWT_SECRET || "default_super_secret_jwt_key_restaurant",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  DATABASE_URL: process.env.DATABASE_URL || "",
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || "rzp_test_sample",
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || "rzp_test_secret",
  UPLOAD_DIR: process.env.UPLOAD_DIR || "uploads",
};

