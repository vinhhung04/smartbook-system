# Demo Seed Coverage Tasks

## Task 1: Route and API audit

**Status:** Complete.

**Acceptance criteria:** every authenticated operational list route is classified with its data source.

**Verification:** inspect route declarations and page service calls.

## Task 2: Automated coverage guard

**Status:** Complete.

**Acceptance criteria:** a test maps required operational pages to seed markers and fails when a marker is absent.

**Verification:** run the focused Node test.

## Task 3: Seed missing workflows

**Status:** Complete.

**Acceptance criteria:** each newly-required workflow returns representative records from its gateway API after the demo seed runs.

**Verification:** run the Docker demo seed and authenticated API checks.
