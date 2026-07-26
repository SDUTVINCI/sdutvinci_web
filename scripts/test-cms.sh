#!/usr/bin/env bash

set -Eeuo pipefail

# The application expects DATABASE_URL internally, but CMS tests may only derive
# it from a separately named and validated TEST_DATABASE_URL.
unset DATABASE_URL

exec ./node_modules/.bin/vitest run \
  tests/cms-auth.integration.test.ts \
  tests/cms-content.integration.test.ts \
  tests/cms-drafts.integration.test.ts \
  tests/cms-workflow.integration.test.ts \
  tests/cms-publishing.integration.test.ts \
  tests/cms-media.integration.test.ts \
  tests/cms-protected-markdown.test.ts \
  tests/cms-security.test.ts
