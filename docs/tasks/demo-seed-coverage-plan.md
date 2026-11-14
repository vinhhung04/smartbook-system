# Implementation Plan: Demo Seed Coverage Audit

## Overview

Audit the authenticated operational routes, map each route to the API data it renders, and make demo-seed coverage executable so an empty operational list is detected before release.

## Architecture Decisions

- Treat pages that create data, auth-only pages, and AI-on-demand pages as out of scope for mandatory list seed coverage.
- Keep seed ownership in the existing service-specific Prisma seed files; do not add a cross-service write script.
- Use a small coverage manifest test for routes whose list data must be present after the demo seed runs.

## Task List

### Phase 1: Audit

- [x] Inventory operational routes and their read APIs.
- [x] Classify each route as seeded, intentionally empty, or missing seed data.

### Phase 2: Coverage guard

- [x] Add a route-to-seed coverage manifest test for required operational screens.
- [x] Verify the test fails if a required route loses its representative seed marker.

### Phase 3: Fill gaps

- [x] Add idempotent seed records for the missing operational workflows.
- [x] Run the demo seed and check representative APIs through the gateway.

### Checkpoint: Complete

- [x] Focused and workspace tests pass.
- [x] Docker demo seed completes successfully.
- [x] No required audited operational route is left without representative data.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Some screens are task queues by design | Seed only records in a safe pending state and explicitly classify creation-only screens. |
| Cross-service IDs are not foreign-keyed | Reuse stable fixture IDs and verify API responses, not only database insertion. |
