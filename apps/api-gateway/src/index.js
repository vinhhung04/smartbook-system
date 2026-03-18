const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { createProxyMiddleware } = require("http-proxy-middleware");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

const authTarget = process.env.AUTH_SERVICE_URL || "http://auth-service:3002";
const inventoryTarget = process.env.INVENTORY_SERVICE_URL || "http://inventory-service:3001";
const aiTarget = process.env.AI_SERVICE_URL || "http://ai-service:8000";

app.use(cors());

app.get("/health", (_req, res) => {
  res.json({
    service: "api-gateway",
    status: "ok",
    authTarget,
    inventoryTarget,
    aiTarget,
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
    pathFilter: "/api",
    target: inventoryTarget,
    changeOrigin: true,
    xfwd: true,
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

app.listen(port, "0.0.0.0", () => {
  console.log(`api-gateway running at http://0.0.0.0:${port}`);
});
