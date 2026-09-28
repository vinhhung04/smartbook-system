const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { startGatewayRabbitMqConsumer } = require("./lib/rabbitmq-consumer");
const {
  createCorsOptions,
  createRateLimiter,
  createRequestContext,
  createRequestLogger,
  requireEnv,
  securityHeaders,
} = require("@smartbook/shared/runtime");
const { getMeter } = require("@smartbook/shared/metrics");

const websocketConnectionsCounter = getMeter("api-gateway").createUpDownCounter("websocket_connections");

dotenv.config();

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 3000);

const authTarget = process.env.AUTH_SERVICE_URL || "http://auth-service:3002";
const inventoryTarget =
  process.env.INVENTORY_SERVICE_URL || "http://inventory-service:3001";
const borrowTarget =
  process.env.BORROW_SERVICE_URL || "http://borrow-service:3005";
const analyticsTarget =
  process.env.ANALYTICS_SERVICE_URL || "http://analytics-service:3006";
const aiTarget = process.env.AI_SERVICE_URL || "http://ai-service:8000";

function handleAiProxyError(_error, req, res) {
  if (res.headersSent) return;
  res.writeHead(503, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    message: "AI tạm thời không khả dụng",
    code: "AI_UNAVAILABLE",
    request_id: req.requestId || null,
  }));
}

const { JWT_SECRET, INTERNAL_SERVICE_KEY } = requireEnv(process.env, [
  "JWT_SECRET",
  "INTERNAL_SERVICE_KEY",
]);
const SOCKET_CORS_ORIGIN =
  process.env.SOCKET_CORS_ORIGIN || "http://localhost:5173";
const socketOrigins = SOCKET_CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);

// --------------- Event & room allowlists ---------------
const ALLOWED_EVENTS = new Set([
  "notification:new",
  "loan:created", "loan:status_changed", "loan:returned", "loan:overdue",
  "loan:renewal_requested", "loan:renewal_reviewed",
  "reservation:created", "reservation:confirmed", "reservation:ready_for_pickup",
  "reservation:cancelled", "reservation:expired", "reservation:converted_to_loan",
  "fine:created", "fine:paid", "fine:waived",
  "stock:low", "stock:out_of_stock", "stock:movement_created", "stock:adjusted",
  "purchase_request:created", "purchase_request:status_changed",
  "purchase_order:created", "purchase_order:status_changed",
  "goods_receipt:created",
  "putaway:created", "putaway:completed",
  "picking:created", "picking:completed",
  "packing:evidence_verified",
  "warehouse_task:assigned", "warehouse_task:status_changed",
  "exception_report:created", "exception_report:resolved",
  "ai_action:created", "ai_action:confirmed", "ai_action:executed",
  "ai_action:failed", "ai_action:cancelled",
]);

// Matches: user:{uuid}, customer:{uuid}, supplier:{uuid}, warehouse:{uuid},
//          admin, warehouse_manager, warehouse_staff, librarian
const ROOM_PATTERN = /^(user|customer|supplier|warehouse):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^(admin|warehouse_manager|warehouse_staff|librarian)$/;

const MAX_PAYLOAD_BYTES = 65536; // 64 KB

// --------------- Socket.io ---------------
const io = new Server(server, {
  cors: {
    origin: socketOrigins,
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

async function resolveCustomerId(userId, email) {
  try {
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    if (userId) params.set("user_id", userId);
    const res = await fetch(
      `${borrowTarget}/internal/customers/resolve?${params}`,
      {
        headers: { "x-internal-service-key": INTERNAL_SERVICE_KEY },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (res.ok) {
      const body = await res.json();
      return body.customer_id || null;
    }
  } catch (err) {
    console.warn("[ws] customer resolve error:", err.message);
  }
  return null;
}

io.on("connection", async (socket) => {
  websocketConnectionsCounter.add(1);
  const user = socket.user;
  const userId = user.id;
  const roles = Array.isArray(user.roles) ? user.roles : [];

  // Always join personal room
  socket.join(`user:${userId}`);

  const joinedRooms = [`user:${userId}`];

  if (roles.includes("ADMIN")) {
    socket.join("admin");
    joinedRooms.push("admin");
  }

  if (roles.includes("LIBRARIAN")) {
    socket.join("librarian");
    joinedRooms.push("librarian");
  }

  if (roles.includes("WAREHOUSE_MANAGER")) {
    socket.join("warehouse_manager");
    joinedRooms.push("warehouse_manager");
  }

  if (roles.includes("WAREHOUSE_STAFF")) {
    socket.join("warehouse_staff");
    joinedRooms.push("warehouse_staff");
  }

  if (roles.includes("CUSTOMER")) {
    const customerId = await resolveCustomerId(userId, user.email);
    if (customerId) {
      socket.join(`customer:${customerId}`);
      joinedRooms.push(`customer:${customerId}`);
    } else {
      console.warn(`[ws] CUSTOMER ${userId} - could not resolve customer_id, staying in user room only`);
    }
  }

  // SUPPLIER: TODO — no user→supplier DB link yet, stays in user:{id} only

  console.log(`[ws] ${userId} (${roles.join(",") || "no-role"}) connected → rooms: ${joinedRooms.join(", ")} (socket ${socket.id})`);

  socket.on("disconnect", (reason) => {
    websocketConnectionsCounter.add(-1);
    console.log(`[ws] ${socket.id} disconnected: ${reason}`);
  });
});

// --------------- Internal push endpoints ---------------
function validateInternalKey(req, res) {
  const key = req.headers["x-internal-service-key"];
  if (key !== INTERNAL_SERVICE_KEY) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

function validateEvent(event, res) {
  if (!ALLOWED_EVENTS.has(event)) {
    res.status(400).json({ message: `Unknown event: ${event}` });
    return false;
  }
  return true;
}

function validateRoom(room, res) {
  if (!ROOM_PATTERN.test(room)) {
    res.status(400).json({ message: `Invalid room: ${room}` });
    return false;
  }
  return true;
}

app.post("/internal/push-event", express.json({ limit: "64kb" }), (req, res) => {
  if (!validateInternalKey(req, res)) return;

  const rawSize = Buffer.byteLength(JSON.stringify(req.body));
  if (rawSize > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ message: "Payload too large" });
  }

  const { room, event, data } = req.body;
  if (!room || !event) {
    return res.status(400).json({ message: "room and event are required" });
  }
  if (!validateEvent(event, res)) return;
  if (!validateRoom(room, res)) return;

  const service = req.headers["x-service-name"] || "unknown";
  console.log(`[push] service=${service} room=${room} event=${event}`);

  io.to(room).emit(event, data || {});
  return res.json({ ok: true });
});

app.post("/internal/push-events", express.json({ limit: "256kb" }), (req, res) => {
  if (!validateInternalKey(req, res)) return;

  const events = req.body?.events;
  if (!Array.isArray(events)) {
    return res.status(400).json({ message: "events array is required" });
  }

  const service = req.headers["x-service-name"] || "unknown";
  let pushed = 0;
  const errors = [];

  for (const evt of events) {
    if (!evt.room || !evt.event) continue;
    if (!ALLOWED_EVENTS.has(evt.event)) {
      errors.push(`unknown event: ${evt.event}`);
      continue;
    }
    if (!ROOM_PATTERN.test(evt.room)) {
      errors.push(`invalid room: ${evt.room}`);
      continue;
    }
    console.log(`[push] service=${service} room=${evt.room} event=${evt.event}`);
    io.to(evt.room).emit(evt.event, evt.data || {});
    pushed++;
  }

  return res.json({ ok: true, pushed, errors: errors.length ? errors : undefined });
});

// --------------- Express middleware ---------------
app.use(createRequestContext("api-gateway"));
app.use(createRequestLogger("api-gateway"));
app.use(securityHeaders);
app.use(cors(createCorsOptions(process.env.ALLOWED_ORIGINS)));
// One nginx reverse proxy sits in front of api-gateway in production, appending the real
// client IP as the last X-Forwarded-For entry — trust exactly that one hop.
app.use(createRateLimiter({ max: 600, windowMs: 15 * 60 * 1000, trustedProxyHops: 1 }));
app.use((req, res, next) => {
  const maxBytes = Number(process.env.GATEWAY_MAX_REQUEST_BYTES || 8 * 1024 * 1024);
  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return res.status(413).json({
      message: "Payload too large",
      code: "PAYLOAD_TOO_LARGE",
      request_id: req.requestId || null,
    });
  }
  return next();
});

app.get("/health", (_req, res) => {
  res.json({
    service: "api-gateway",
    status: "ok",
    version: "1.0.0",
  });
});

const DEPENDENCY_TIMEOUT_MS = 2000;

// Core services expose /ready (process + database); AI is optional, so its outage
// degrades the system instead of failing gateway readiness.
const DEPENDENCIES = [
  { id: "auth-service", name: "Auth Service", description: "Đăng nhập, người dùng và phân quyền", target: authTarget, path: "/ready", critical: true },
  { id: "inventory-service", name: "Inventory Service", description: "Danh mục sách, tồn kho và kho vận", target: inventoryTarget, path: "/ready", critical: true },
  { id: "borrow-service", name: "Borrow Service", description: "Khách hàng, đặt trước, mượn trả và tiền phạt", target: borrowTarget, path: "/ready", critical: true },
  { id: "analytics-service", name: "Analytics Service", description: "Báo cáo và số liệu tổng quan", target: analyticsTarget, path: "/ready", critical: true },
  { id: "ai-service", name: "AI Service", description: "Trợ lý AI, OCR và gợi ý metadata qua OpenRouter", target: aiTarget, path: "/health", critical: false },
];

const ADMIN_PERMISSIONS = ["auth.users.read", "auth.roles.read", "auth.permissions.read", "audit.read"];

async function probeDependency(dependency) {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${dependency.target}${dependency.path}`, {
      signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    let details = null;
    try {
      details = await response.json();
    } catch {
      details = null;
    }
    return {
      id: dependency.id,
      name: dependency.name,
      description: dependency.description,
      critical: dependency.critical,
      status: response.ok ? "ok" : "down",
      latency_ms: latencyMs,
      error: response.ok ? null : `HTTP ${response.status}`,
      details,
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      id: dependency.id,
      name: dependency.name,
      description: dependency.description,
      critical: dependency.critical,
      status: "down",
      latency_ms: Math.round(performance.now() - startedAt),
      error: timedOut ? `Không phản hồi sau ${DEPENDENCY_TIMEOUT_MS / 1000}s` : "Không kết nối được",
      details: null,
    };
  }
}

function requireAdminToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Authentication required", code: "UNAUTHORIZED" });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Invalid token", code: "UNAUTHORIZED" });
  }
  const roles = Array.isArray(payload.roles) ? payload.roles.map((role) => String(role).toUpperCase()) : [];
  const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
  const allowed = payload.is_superuser === true
    || roles.includes("ADMIN")
    || ADMIN_PERMISSIONS.some((permission) => permissions.includes(permission));
  if (!allowed) return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  return next();
}

app.get("/ready", async (_req, res) => {
  const results = await Promise.all(DEPENDENCIES.filter((dependency) => dependency.critical).map(probeDependency));
  if (results.some((result) => result.status !== "ok")) {
    return res.status(503).json({ service: "api-gateway", status: "not_ready" });
  }
  return res.json({ service: "api-gateway", status: "ready" });
});

// Per-service breakdown for the admin monitor. Kept behind admin auth because it
// reveals the internal service layout that the public /ready deliberately hides.
app.get("/system/health", requireAdminToken, async (_req, res) => {
  const services = await Promise.all(DEPENDENCIES.map(probeDependency));
  const criticalDown = services.some((service) => service.critical && service.status !== "ok");
  const optionalDown = services.some((service) => !service.critical && service.status !== "ok");
  res.set("Cache-Control", "no-store");
  return res.json({
    status: criticalDown ? "down" : optionalDown ? "degraded" : "ok",
    checked_at: new Date().toISOString(),
    gateway: {
      version: "1.0.0",
      uptime_seconds: Math.round(process.uptime()),
      connected_sockets: io.engine.clientsCount,
    },
    services,
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
    on: { error: handleAiProxyError },
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
  createProxyMiddleware({
    pathFilter: "/webhooks",
    target: borrowTarget,
    changeOrigin: true,
    xfwd: true,
  }),
);

app.use(
  createProxyMiddleware({
    pathFilter: "/analytics",
    target: analyticsTarget,
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
    on: { error: handleAiProxyError },
  }),
);

app.use((error, req, res, _next) => {
  const status = error?.message?.startsWith("CORS origin not allowed") ? 403 : 502;
  return res.status(status).json({
    message: status === 403 ? "Origin not allowed" : "Gateway request failed",
    code: status === 403 ? "CORS_ORIGIN_DENIED" : "GATEWAY_ERROR",
    request_id: req.requestId || null,
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`api-gateway running at http://0.0.0.0:${port} (HTTP + WebSocket)`);
  startGatewayRabbitMqConsumer(io);
});
