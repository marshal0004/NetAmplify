#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/publish.sh
# NetAmplify — curl tests for /api/postcards/:id/publish + /api/posts/* endpoints.
#
# Requires a logged-in user + a created PostCard + an active connection.
# Run AFTER auth.sh + postcards.sh + connections.sh:
#   bash scripts/curl-tests/auth.sh
#   bash scripts/curl-tests/postcards.sh  (creates a PostCard)
#   bash scripts/curl-tests/connections.sh
#   bash scripts/curl-tests/publish.sh

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

TEST_EMAIL="pub_$(date +%s)_$(shuf -i 1-99999 -n 1)@example.com"
TEST_PASSWORD="StrongPass1"
TEST_NAME="Publish Tester"

echo -e "${YELLOW}=== NetAmplify Publish curl-tests ===${NC}"
echo "Base URL: $BASE_URL"
echo ""

# 1. Signup
echo -e "${YELLOW}[setup] signup${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"$TEST_NAME\"}")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
if [ "$STATUS" = "201" ]; then
  ACCESS_TOKEN=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])" 2>/dev/null || echo "")
  if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${RED}FAILED:${NC} no accessToken"; exit 1
  fi
  echo -e "  ${GREEN}✓${NC} signup → got JWT"
else
  echo -e "${RED}FAILED:${NC} signup returned $STATUS"; exit 1
fi
echo ""

# 2. Create a PostCard to publish
echo -e "${Yellow}[setup] create PostCard${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/postcards" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"title":"Publishable Project","summary":"Test publish","description":"Description body","techStack":["TypeScript"],"repoUrl":"https://github.com/user/repo"}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
if [ "$STATUS" = "201" ]; then
  POSTCARD_ID=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
  echo -e "  ${GREEN}✓${NC} PostCard created (id: $POSTCARD_ID)"
else
  echo -e "${RED}FAILED:${NC} PostCard creation returned $STATUS"; exit 1
fi
echo ""

# 3. POST /api/postcards/:id/publish (without any connection → 400)
echo -e "${YELLOW}[1/9] POST /api/postcards/:id/publish (no connections)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/postcards/$POSTCARD_ID/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"platforms":[{"platform":"REDDIT","options":{"subreddit":"test"}}]}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
assert_status "publish without connection" "400" "$STATUS"
assert_contains "error mentions missing connection" "No active connection" "$BODY"
echo ""

# 4. POST /api/postcards/:id/publish (no platforms → 400 validation)
echo -e "${YELLOW}[2/9] POST /api/postcards/:id/publish (empty platforms)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/postcards/$POSTCARD_ID/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"platforms":[]}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "publish empty platforms" "400" "$STATUS"
echo ""

# 5. POST /api/postcards/:id/publish (invalid platform → 400)
echo -e "${YELLOW}[3/9] POST /api/postcards/:id/publish (unknown platform)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/postcards/$POSTCARD_ID/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"platforms":[{"platform":"INSTAGRAM"}]}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "publish unknown platform" "400" "$STATUS"
echo ""

# 6. POST /api/postcards/:id/publish (nonexistent postcard → 404)
echo -e "${YELLOW}[4/9] POST /api/postcards/nonexistent/publish${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/postcards/nonexistent-id/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"platforms":[{"platform":"REDDIT"}]}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "publish nonexistent postcard" "404" "$STATUS"
echo ""

# 7. GET /api/posts (initial empty state)
echo -e "${YELLOW}[5/9] GET /api/posts (initial empty)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/posts" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET posts (empty)" "200" "$STATUS"
assert_contains "empty items array" "\"items\":\[\]" "$BODY"
echo ""

# 8. GET /api/posts (without JWT → 401)
echo -e "${YELLOW}[6/9] GET /api/posts (no JWT → 401)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/posts")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET posts no JWT" "401" "$STATUS"
echo ""

# 9. GET /api/posts/:id (nonexistent → 404)
echo -e "${YELLOW}[7/9] GET /api/posts/:id (nonexistent)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/posts/nonexistent-id" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET nonexistent post" "404" "$STATUS"
echo ""

# 10. POST /api/posts/:id/targets/:targetId/retry (nonexistent post → 404)
echo -e "${YELLOW}[8/9] POST /api/posts/:id/targets/:targetId/retry (nonexistent)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/posts/nonexistent-id/targets/target-1/retry" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "retry nonexistent post" "404" "$STATUS"
echo ""

# 11. Idempotency check — publish with same requestId twice returns same Post
# (we'd need a connection to test this fully; just verify the validation works)
echo -e "${YELLOW}[9/9] Idempotency: same requestId twice returns same Post${NC}"
# This test is informational — actual publish needs a connection
echo -e "  ${YELLOW}ℹ${NC} Skipped — requires real platform connection (test on Arch)"
echo ""

echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ curl-tests/publish.sh FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}✅ curl-tests/publish.sh PASSED${NC}"
exit 0
