import http from "http";
import { app } from "./app.js";
import { ENV } from "./config/env.js";
import { initSocketIO } from "./services/socketService.js";
import { prisma } from "./config/db.js";

const server = http.createServer(app);

// Initialize real-time Socket.IO
initSocketIO(server, ENV.CLIENT_URL);

server.listen(ENV.PORT, () => {
  console.log(`🚀 Restaurant Backend Server running on http://localhost:${ENV.PORT}`);
  console.log(`📡 Socket.IO initialized with CORS allowed origin: ${ENV.CLIENT_URL}`);
  console.log(`🌿 Environment: ${ENV.NODE_ENV}`);
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Gracefully shutting down...`);
  server.close(async () => {
    console.log("🔒 HTTP server closed.");
    await prisma.$disconnect();
    console.log("💾 Prisma client disconnected.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

