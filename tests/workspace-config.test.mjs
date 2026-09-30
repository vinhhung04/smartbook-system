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

test("every CI job that boots the stack lifts the login rate limit", () => {
  // The production default is 10 logins per 15 minutes. The Docker jobs log in far more
  // often than that (7 integration scripts; a Playwright suite with a login per test),
  // so each job that generates a .env must also raise it, or logins start returning 429.
  const workflow = readFileSync(
    resolve(repositoryRoot, ".github/workflows/ci.yml"),
    "utf8",
  );
  const stacks = workflow.match(/node scripts\/init-demo-env\.mjs/g) ?? [];
  const lifted = workflow.match(/AUTH_LOGIN_RATE_LIMIT_MAX=\d+" >> \.env/g) ?? [];
  assert.ok(stacks.length >= 2, "expected the integration and e2e jobs to generate a .env");
  assert.equal(lifted.length, stacks.length);
});

test("workspace exposes one complete verification command", () => {
  const manifest = readJson("package.json");
  assert.match(manifest.scripts.verify, /lint:ci/);
  assert.match(manifest.scripts.verify, /typecheck/);
  assert.match(manifest.scripts.verify, /build/);
  assert.match(manifest.scripts.verify, /test:node/);
  assert.match(manifest.scripts.verify, /test:ai/);
});

test("workspace exposes repeatable demo seed and golden-flow commands", () => {
  const manifest = readJson("package.json");
  assert.match(manifest.scripts["demo:seed"], /--profile demo/);
  assert.match(manifest.scripts["test:smoke"], /demo-smoke\.mjs/);
  const smoke = readFileSync(resolve(repositoryRoot, "scripts/demo-smoke.mjs"), "utf8");
  assert.match(smoke, /rbac-role-access-integration/);
  assert.match(smoke, /purchase-supplier-receiving-integration/);
  assert.match(smoke, /borrow-phase2-integration/);
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

test("workspace lint and build quote their package globs", () => {
  // Unquoted, sh (CI) expands ./apps/* into ./apps/api-gateway ./apps/mobile ...
  // and pnpm then treats ./apps/mobile as the script name: it prints "None of the
  // selected packages has a script" and exits 0, so lint/build silently never run.
  // \" (not ') so cmd on Windows strips the quotes as well.
  const manifest = readJson("package.json");
  for (const name of ["lint", "build"]) {
    assert.match(manifest.scripts[name], /--filter "\.\/apps\/\*"/, `${name} must quote its ./apps/* filter`);
  }
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
  const nginx = readFileSync(resolve(repositoryRoot, "apps/web/nginx.conf"), "utf8");
  assert.match(dockerfile, /FROM nginx:/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html/);
  assert.match(nginx, /Content-Security-Policy/);
  assert.match(nginx, /Permissions-Policy/);
});

test("web pages are loaded on demand", () => {
  const routes = readFileSync(resolve(repositoryRoot, "apps/web/src/app/routes.ts"), "utf8");
  assert.doesNotMatch(routes, /from ["']@\/components\/pages\//);
  for (const module of ["dashboard", "ai-import", "reports", "picking", "packing", "stock-audits"] ) {
    assert.match(routes, new RegExp(`import\\(.*pages/${module}`), module);
  }
});

test("admin monitor only calls public gateway health boundaries", () => {
  const monitor = readFileSync(resolve(repositoryRoot, "apps/web/src/services/monitor.ts"), "utf8");
  assert.match(monitor, /localhost:3000\/health/);
  assert.match(monitor, /localhost:3000\/ready/);
  assert.doesNotMatch(monitor, /localhost:300[1-9]/);
  assert.match(monitor, /'ready'/);
});
