#!/bin/bash
# Runs inside the test:ai container. Mounts: /src (extension, read-only), /logins (read-only), /results.
# The CLIs get copies of the logins, so a token they refresh here never reaches the host's files.
set -euo pipefail
mkdir -p /w
(cd /src && tar --exclude=node_modules --exclude=out --exclude=.vscode-test --exclude='*.vsix' -cf - .) | tar -xf - -C /w
cd /w
npm ci --no-audit --no-fund >/tmp/npm-ci.log 2>&1 || { cat /tmp/npm-ci.log; exit 1; }
npm run compile >/dev/null
npx tsc -p tsconfig.test.json
if [ -f /logins/codex/auth.json ]; then mkdir -p /root/.codex && cp /logins/codex/auth.json /root/.codex/auth.json; fi
if [ -f /logins/opencode/auth.json ]; then mkdir -p /root/.local/share/opencode && cp /logins/opencode/auth.json /root/.local/share/opencode/auth.json; fi
for cli in $SHARP_PEN_CLIS; do
  echo "== $cli"
  SHARP_PEN_REAL_CLI="$cli" SHARP_PEN_RESULT_FILE="/results/$cli.json" \
    xvfb-run -a node out/test/integration/runTest.js >"/results/$cli.log" 2>&1 || true
done
