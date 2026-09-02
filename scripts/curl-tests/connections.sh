#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/connections.sh
# NetAmplify — curl tests for /api/connections/* endpoints.
#
# Requires a logged-in user (signup first). Run AFTER auth.sh:
#   bash scripts/curl-tests/auth.sh
#   bash scripts/curl-tests/connections.sh

set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

assert_status() {
  local label="$1"; local expected="$2"; local actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $label (HTTP $actual)"; PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗${NC} $label — expected $expected, got $actual"; FAIL=$((FAIL+1))
  fi
}

assert_contains() {
  local label="$1"; local needle="$2"; local haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    echo -e "  ${GREEN}✓${NC} $label (contains \"$needle\")"; PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗${NC} $label — expected to contain \"$needle\", got: $haystack"; FAIL=$((FAIL+1))
  fi
}

# Generate unique email + signup to get JWT
TEST_EMAIL="conn_$(date +%s)_$(shuf -i 1-99999 -n 1)@example.com"
TEST_PASSWORD="StrongPass1"
TEST_NAME="Connection Tester"

echo -e "${YELLOW}=== NetAmplify Connections curl-tests ===${NC}"
echo "Base URL: $BASE_URL"
echo "Using fresh test user: $TEST_EMAIL"
echo ""

# 1. Signup (get JWT)
echo -e "${YELLOW}[setup] signup${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"$TEST_NAME\"}")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
if [ "$STATUS" = "201" ]; then
  ACCESS_TOKEN=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])" 2>/dev/null || echo "")
  if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${RED}FAILED:${NC} no accessToken from signup"; exit 1
  fi
  echo -e "  ${GREEN}✓${NC} signup → got JWT"
else
  echo -e "${RED}FAILED:${NC} signup returned $STATUS"; exit 1
fi
echo ""

# 2. GET /api/connections (initial: no connections)
echo -e "${YELLOW}[1/12] GET /api/connections (empty initial state)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/connections" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET connections (no JWT-guard) status" "200" "$STATUS"
echo -e "  (8 entries with status 'not-connected' expected; response logged)"
echo ""

# 3. GET /api/connections without JWT → 401
echo -e "${YELLOW}[2/12] GET /api/connections (no JWT → 401)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/connections")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "no-JWT connections" "401" "$STATUS"
echo ""

# 4. POST /api/connections/devto (happy path)
echo -e "${YELLOW}[3/12] POST /api/connections/devto (with mock key)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/devto" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"apiKey":"dev-to-test-api-key-12345"}')
STATUS=$(echo "$RESP" | tail -n1)
# Note: this will likely fail with INVALID_CREDENTIALS since the key is fake
# We assert it returns 400 (validation/auth error from Dev.to API), not 500
assert_status "devto connect (mock key → 400 expected)" "400" "$STATUS"
echo ""

# 5. POST /api/connections/devto (missing apiKey → 400)
echo -e "${YELLOW}[4/12] POST /api/connections/devto (missing apiKey)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/devto" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "devto connect (no apiKey)" "400" "$STATUS"
echo ""

# 6. POST /api/connections/discord (invalid URL format)
echo -e "${YELLOW}[5/12] POST /api/connections/discord (invalid URL)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/discord" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"webhookUrl":"https://example.com/not-a-discord-webhook"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "discord connect (non-Discord URL)" "400" "$STATUS"
echo ""

# 7. POST /api/connections/discord (no URL → 400)
echo -e "${Yellow}[6/12] POST /api/connections/discord (no URL)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/discord" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "discord connect (no webhookUrl)" "400" "$STATUS"
echo ""

# 8. POST /api/connections/telegram (no botToken → 400)
echo -e "${YELLOW}[7/12] POST /api/connections/telegram (no botToken)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/telegram" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"channel":"@mychannel"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "telegram connect (no botToken)" "400" "$STATUS"
echo ""

# 9. POST /api/connections/bluesky (invalid app password format → 400)
echo -e "${YELLOW}[8/12] POST /api/connections/bluesky (bad app password format)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/bluesky" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"handle":"jane.bsky.social","appPassword":"no-dashes-here"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "bluesky connect (bad app password format)" "400" "$STATUS"
echo ""

# 10. POST /api/connections/hashnode (no PAT → 400)
echo -e "${YELLOW}[9/12] POST /api/connections/hashnode (no PAT)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/hashnode" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "hashnode connect (no pat)" "400" "$STATUS"
echo ""

# 11. POST /api/connections/bluesky (no handle → 400)
echo -e "${YELLOW}[10/12] POST /api/connections/bluesky (no handle)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/bluesky" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"appPassword":"abcd-efgh-ijkl-mnop"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "bluesky connect (no handle)" "400" "$STATUS"
echo ""

# 12. DELETE /api/connections/devto (no connection exists → 404)
echo -e "${YELLOW}[11/12] DELETE /api/connections/devto (no connection)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/api/connections/devto" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "disconnect devto (no existing conn)" "404" "$STATUS"
echo ""

# 13. DELETE /api/connections/instagram (unknown platform → 400)
echo -e "${YELLOW}[12/12] DELETE /api/connections/instagram (unknown platform)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/api/connections/instagram" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "disconnect unknown platform" "400" "$STATUS"
echo ""

# Summary
echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ curl-tests/connections.sh FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}✅ curl-tests/connections.sh PASSED${NC}"
exit 0
