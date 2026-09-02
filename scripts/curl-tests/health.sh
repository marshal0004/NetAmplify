#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/health.sh
# NetAmplify — curl test for /api/health endpoint.

set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}=== NetAmplify Health curl-test ===${NC}"
echo "Base URL: $BASE_URL"
echo ""

echo -e "${YELLOW}[1/1] GET /api/health${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/health")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n1)

if [ "$STATUS" = "200" ]; then
  echo -e "  ${GREEN}✓${NC} /api/health returned 200"
  PASS=$((PASS+1))
else
  echo -e "  ${RED}✗${NC} /api/health — expected 200, got $STATUS"
  FAIL=$((FAIL+1))
fi

if echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'db' in d and 'redis' in d, 'missing fields'" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} response body contains db + redis fields"
  PASS=$((PASS+1))
else
  echo -e "  ${RED}✗${NC} response body missing db/redis fields. Body: $BODY"
  FAIL=$((FAIL+1))
fi

echo ""
echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ curl-tests/health.sh FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}✅ curl-tests/health.sh PASSED${NC}"
exit 0
