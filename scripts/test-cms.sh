#!/usr/bin/env bash

set -Eeuo pipefail

# Keep the caller's DATABASE_URL visible until the test helper compares its
# target with TEST_DATABASE_URL. Each database suite then replaces it with the
# separately named and validated test URL before opening a connection.

exec ./node_modules/.bin/vitest run \
  tests/cms-auth.integration.test.ts \
  tests/account-registrations.integration.test.ts \
  tests/account-registration-ui.test.ts \
  tests/cms-content.integration.test.ts \
  tests/cms-drafts.integration.test.ts \
  tests/cms-workflow.integration.test.ts \
  tests/cms-publishing.integration.test.ts \
  tests/cms-media.integration.test.ts \
  tests/v2-revision-backfill.integration.test.ts \
  tests/v2-revision-shadow.integration.test.ts \
  tests/v2-public-content-shadow.integration.test.ts \
  tests/v2-database-authority.integration.test.ts \
  tests/v2-content-export.integration.test.ts \
  tests/v2-phase7-reconciliation-recovery.integration.test.ts \
  tests/v2-content-pr-import.integration.test.ts \
  tests/cms-protected-markdown.test.ts \
  tests/cms-security.test.ts \
  tests/cms-theme.test.ts \
  tests/cms-local-test-environment.test.ts
