#!/usr/bin/env bash
# Rebuild the hosted demo (docs/index.html) from docs/source.md + docs/changes.json.
#
# The demo is an ordinary review page with one addition the skill itself never
# makes: a cookieless page-view counter (Cloudflare Web Analytics), appended
# after the build so it can never leak into the template users run locally.
#
#   docs/build.sh                      # rebuild with the counter
#   CF_BEACON_TOKEN= docs/build.sh     # rebuild without it
#
# The token is public by design (it ships in the page source), so it lives here
# rather than in an env var someone has to remember.
set -euo pipefail
cd "$(dirname "$0")"
CF_BEACON_TOKEN="${CF_BEACON_TOKEN-1d841c1ae78c4571bd2b3669bb13a9a5}"

python3 ../sharp-pen/skills/review/scripts/build.py \
  --source source.md --changes changes.json --out index.html

if [[ -n "${CF_BEACON_TOKEN:-}" ]]; then
  snippet="<!-- hosted demo only: cookieless page-view counter, see ../PRIVACY.md -->
<script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{\"token\": \"$CF_BEACON_TOKEN\"}'></script>
</body>"
  # ponytail: plain text replace of the single closing </body>; the template has exactly one
  python3 - "$snippet" <<'PY'
import pathlib, sys
p = pathlib.Path("index.html"); s = p.read_text()
assert s.count("</body>") == 1, "expected exactly one </body> in the built page"
p.write_text(s.replace("</body>", sys.argv[1]))
PY
  echo "demo rebuilt with counter"
else
  echo "demo rebuilt, no counter (CF_BEACON_TOKEN unset)"
fi
