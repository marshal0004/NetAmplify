#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/run-all.sh
# NetAmplify — run all curl-test scripts in order. Exits non-zero on first failure.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}=== NetAmplify — running all curl-tests ===${NC}"
echo ""

# Sanity check: is the dev server up?
if ! curl -s -o /dev/null -w "%{http_code}" "$BASE_URL" --max-time 5 | grep -qE "^(200|302|404|503)$"; then
  echo -e "${RED}ERROR:${NC} Dev server not responding at \${BASE_URL:-http://localhost:3000}."
  echo "Start it first: pnpm dev:backend"
  exit 1
fi

PASS=0
FAIL=0

for script in "$SCRIPT_DIR"/health.sh "$SCRIPT_DIR"/auth.sh "$SCRIPT_DIR"/connections.sh; do
  if [ ! -f "$script" ]; then
    continue
  fi
  echo -e "${YELLOW}--- Running $script ---${NC}"
  if bash "$script"; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
  fi
  echo ""
done

echo -e "${YELLOW}=== run-all Summary ===${NC}"
echo -e "  ${GREEN}Scripts passed:${NC} $PASS"
echo -e "  ${RED}Scripts failed:${NC} $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ curl-tests FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}✅ curl-tests PASSED${NC}"
exit 0
