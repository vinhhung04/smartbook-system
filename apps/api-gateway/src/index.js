const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

dotenv.config();

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 3000);

const authTarget = process.env.AUTH_SERVICE_URL || "http://auth-service:3002";
const inventoryTarget =
  process.env.INVENTORY_SERVICE_URL || "http://inventory-service:3001";
const borrowTarget =
  process.env.BORROW_SERVICE_URL || "http://borrow-service:3005";
const aiTarget = process.env.AI_SERVICE_URL || "http://ai-service:8000";

const JWT_SECRET = process.env.JWT_SECRET || "smartbook_shared_jwt_secret";
const INTERNAL_SERVICE_KEY =
  process.env.INTERNAL_SERVICE_KEY || "smartbook_internal_key";

// --------------- Socket.io ---------------
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  path: "/socket.io",
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error("Authentication required"));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = {
      ...payload,
      id: payload.id || payload.sub,
    };
    return next();
  } catch {
    return next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  const user = socket.user;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const isCustomer = roles.includes("CUSTOMER");

  if (isCustomer && user.customer_id) {
    socket.join(`customer:${user.customer_id}`);
    console.log(
      `[ws] customer ${user.customer_id} connected (socket ${socket.id})`,
    );
  } else {
    socket.join("admin");
    console.log(`[ws] admin ${user.id} connected (socket ${socket.id})`);
  }

  socket.on("disconnect", (reason) => {
    console.log(`[ws] ${socket.id} disconnected: ${reason}`);
  });
});

// --------------- Internal push endpoint ---------------
app.post("/internal/push-event", express.json(), (req, res) => {
  const key = req.headers["x-internal-service-key"];
  if (key !== INTERNAL_SERVICE_KEY) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { room, event, data } = req.body;
  if (!room || !event) {
    return res.status(400).json({ message: "room and event are required" });
  }

  io.to(room).emit(event, data || {});
  return res.json({ ok: true });
});

// Batch push: send multiple events in one request
app.post("/internal/push-events", express.json(), (req, res) => {
  const key = req.headers["x-internal-service-key"];
  if (key !== INTERNAL_SERVICE_KEY) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const events = req.body?.events;
  if (!Array.isArray(events)) {
    return res.status(400).json({ message: "events array is required" });
  }

  for (const evt of events) {
    if (evt.room && evt.event) {
      io.to(evt.room).emit(evt.event, evt.data || {});
    }
  }
  return res.json({ ok: true, pushed: events.length });
});

// --------------- Express middleware ---------------
app.use(cors());

app.get("/health", (_req, res) => {
  res.json({
    service: "api-gateway",
    status: "ok",
    authTarget,
    inventoryTarget,
    borrowTarget,
    aiTarget,
    connectedSockets: io.engine?.clientsCount || 0,
  });
});

app.use(
  createProxyMiddleware({
    pathFilter: "/auth",
    target: authTarget,
    changeOrigin: true,
    xfwd: true,
  }),
);

app.use(
  createProxyMiddleware({
    pathFilter: "/iam",
    target: authTarget,
    changeOrigin: true,
    xfwd: true,
  }),
);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/ai",
    target: aiTarget,
    changeOrigin: true,
    xfwd: true,
  }),
);

app.use(
  createProxyMiddleware({
    pathFilter: "/api",
    target: inventoryTarget,
    changeOrigin: true,
    xfwd: true,
  }),
);

app.use(
  createProxyMiddleware({
    pathFilter: "/borrow",
    target: borrowTarget,
    changeOrigin: true,
    xfwd: true,
  }),
);

app.use(
  "/my",
  createProxyMiddleware({
    target: borrowTarget,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: (path) => `/borrow/my${path}`,
  }),
);

app.use(
  "/catalog",
  createProxyMiddleware({
    target: inventoryTarget,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: (path) => `/api${path}`,
  }),
);

app.use(
  "/ai",
  createProxyMiddleware({
    target: aiTarget,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: { "^/ai": "" },
  }),
);

server.listen(port, "0.0.0.0", () => {
  console.log(`api-gateway running at http://0.0.0.0:${port} (HTTP + WebSocket)`);
});
