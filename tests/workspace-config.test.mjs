import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const readJson = (relativePath) =>
  JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));

test("workspace declares the pinned pnpm package manager", () => {
  const manifest = readJson("package.json");
  assert.equal(manifest.packageManager, "pnpm@10.6.2");
});

test("pnpm lockfile is present and npm lockfile is not tracked", () => {
  assert.equal(existsSync(resolve(repositoryRoot, "pnpm-lock.yaml")), true);
  assert.equal(existsSync(resolve(repositoryRoot, "package-lock.json")), false);
});

test("CI installs dependencies reproducibly", () => {
  const workflow = readFileSync(
    resolve(repositoryRoot, ".github/workflows/ci.yml"),
    "utf8",
  );
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm verify/);
  assert.doesNotMatch(workflow, /test_stock_request\.py is excluded/);
});

test("workspace exposes one complete verification command", () => {
  const manifest = readJson("package.json");
  assert.match(manifest.scripts.verify, /lint:ci/);
  assert.match(manifest.scripts.verify, /typecheck/);
  assert.match(manifest.scripts.verify, /build/);
  assert.match(manifest.scripts.verify, /test:node/);
  assert.match(manifest.scripts.verify, /test:ai/);
});

test("every Node service has a real test command", () => {
  const manifests = [
    "apps/api-gateway/package.json",
    "services/analytics-service/package.json",
    "services/auth-service/package.json",
    "services/borrow-service/package.json",
    "services/inventory-service/package.json",
  ];

  for (const manifestPath of manifests) {
    const testCommand = readJson(manifestPath).scripts?.test || "";
    assert.match(testCommand, /node --test/, `${manifestPath} must run Node tests`);
    assert.doesNotMatch(testCommand, /no test specified/);
  }
});

test("web build and lint commands use locally installed tools", () => {
  const manifest = readJson("apps/web/package.json");
  assert.match(manifest.scripts.build, /vite\.js build/);
  assert.match(manifest.scripts.lint, /eslint\.js/);
});

test("Node Docker images build from the workspace lockfile", () => {
  const compose = readFileSync(resolve(repositoryRoot, "docker-compose.yml"), "utf8");
  const dockerfiles = [
    "apps/api-gateway/Dockerfile",
    "apps/web/Dockerfile",
    "services/analytics-service/Dockerfile",
    "services/auth-service/Dockerfile",
    "services/borrow-service/Dockerfile",
    "services/inventory-service/Dockerfile",
  ];

  assert.match(compose, /context: \./);
  for (const dockerfile of dockerfiles) {
    const contents = readFileSync(resolve(repositoryRoot, dockerfile), "utf8");
    assert.match(contents, /COPY package\.json pnpm-lock\.yaml pnpm-workspace\.yaml/);
    assert.match(contents, /pnpm install --frozen-lockfile/);
    if (dockerfile !== "apps/web/Dockerfile") {
      assert.match(contents, /pnpm --filter .* deploy --legacy --prod \/app/);
    }
    if (dockerfile.includes("service") && !dockerfile.includes("analytics")) {
      assert.match(contents, /RUN node_modules\/.bin\/prisma generate/);
    }
  }
});

test("web container serves the built single-page application", () => {
  const dockerfile = readFileSync(resolve(repositoryRoot, "apps/web/Dockerfile"), "utf8");
  assert.match(dockerfile, /CMD \["serve", "-s", "dist", "-l", "5173"\]/);
});

test("web pages are loaded on demand", () => {
  const routes = readFileSync(resolve(repositoryRoot, "apps/web/src/app/routes.ts"), "utf8");
  assert.doesNotMatch(routes, /from ["']@\/components\/pages\//);
  for (const module of ["dashboard", "ai-import", "reports", "picking", "packing", "stock-audits"] ) {
    assert.match(routes, new RegExp(`import\\(.*pages/${module}`), module);
  }
});
