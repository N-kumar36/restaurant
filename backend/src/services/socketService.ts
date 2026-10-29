import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";

let io: SocketIOServer | null = null;

export function initSocketIO(server: HTTPServer, allowedOrigin: string): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: [allowedOrigin, "http://localhost:3000", "http://127.0.0.1:3000"],
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  io.on("connection", (socket) => {
    // Join restaurant admin room
    socket.on("join:restaurant", (restaurantId: string) => {
      if (restaurantId) {
        socket.join(`restaurant:${restaurantId}`);
      }
    });

    // Join customer order tracking room
    socket.on("join:order", (orderId: string) => {
      if (orderId) {
        socket.join(`order:${orderId}`);
      }
    });

    socket.on("leave:order", (orderId: string) => {
      if (orderId) {
        socket.leave(`order:${orderId}`);
      }
    });

    socket.on("disconnect", () => {
      // socket disconnected
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error("Socket.IO has not been initialized!");
  }
  return io;
}

export function notifyNewOrder(restaurantId: string, orderData: any) {
  if (io) {
    io.to(`restaurant:${restaurantId}`).emit("order:new", orderData);
  }
}

export function notifyOrderStatusChange(orderId: string, restaurantId: string, status: string, orderData: any) {
  if (io) {
    // Notify customer tracking room
    io.to(`order:${orderId}`).emit("order:status_change", {
      orderId,
      status,
      updatedAt: new Date().toISOString(),
      order: orderData,
    });

    // Notify restaurant dashboard room
    io.to(`restaurant:${restaurantId}`).emit("order:status_updated", {
      orderId,
      status,
      updatedAt: new Date().toISOString(),
      order: orderData,
    });
  }
}

