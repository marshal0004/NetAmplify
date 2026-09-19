#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/new-platforms.sh
# NetAmplify — curl tests for the new platform endpoints (cookie + Mastodon + WordPress).

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

TEST_EMAIL="np_$(date +%s)_$(shuf -i 1-99999 -n 1)@example.com"
TEST_PASSWORD="StrongPass1"
TEST_NAME="New Platforms Tester"

echo -e "${YELLOW}=== NetAmplify New-Platforms curl-tests ===${NC}"
echo "Base URL: $BASE_URL"
echo "Using fresh test user: $TEST_EMAIL"
echo ""

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
  echo -e "${RED}FAILED:${NC} signup returned $STATUS: $BODY"; exit 1
fi
echo ""

echo -e "${YELLOW}[1/14] GET /api/connections (12 platforms)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/connections" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET connections (with JWT)" "200" "$STATUS"
PLATFORM_COUNT=$(echo "$BODY" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$PLATFORM_COUNT" = "12" ]; then
  echo -e "  ${GREEN}✓${NC} 12 platforms returned (incl. TWITTER_COOKIE, REDDIT_COOKIE, MASTODON, WORDPRESS)"; PASS=$((PASS+1))
else
  echo -e "  ${RED}✗${NC} expected 12 platforms, got $PLATFORM_COUNT"; FAIL=$((FAIL+1))
fi
assert_contains "TWITTER_COOKIE in response" "TWITTER_COOKIE" "$BODY"
assert_contains "REDDIT_COOKIE in response" "REDDIT_COOKIE" "$BODY"
assert_contains "MASTODON in response" "MASTODON" "$BODY"
assert_contains "WORDPRESS in response" "WORDPRESS" "$BODY"
echo ""

echo -e "${YELLOW}[2/14] POST /api/connections/twitter-cookie (no authToken)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/twitter-cookie" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"ct0":"abc"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "twitter-cookie connect (no authToken)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[3/14] POST /api/connections/twitter-cookie (wrong authToken length)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/twitter-cookie" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"authToken":"too-short","ct0":"abc"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "twitter-cookie connect (bad authToken length)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[4/14] POST /api/connections/twitter-cookie (valid format, mock creds)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/twitter-cookie" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"authToken\":\"$(printf 'a%.0s' {1..40})\",\"ct0\":\"$(printf 'b%.0s' {1..32})\"}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "twitter-cookie connect (mock valid format → 400 from X)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[5/14] POST /api/connections/reddit-cookie (no token)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/reddit-cookie" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"csrfToken":"abc"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "reddit-cookie connect (no token)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[6/14] POST /api/connections/reddit-cookie (token too short)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/reddit-cookie" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"token":"short.token.sig","csrfToken":"1234567890abcdef1234567890abcdef"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "reddit-cookie connect (short token)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[7/14] POST /api/connections/reddit-cookie (valid JWT format, mock creds)${NC}"
# Build a synthetic JWT-looking string (3 dot-separated base64url parts, 100+ chars total)
MOCK_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0Ml90ZXN0MTIzIiwiZXhwIjoxODA1MjA4MjUxfQ.i_sh3PJq3MLXxk7yWrsebpXdGM6Gul2uPyOLw5AfrVZN6340_vTdPWTVkG0sNfmeoaGGxb3xAet9BT2-_U_uXEVB9Cx1pHEm3o35V3gdGAxPcrqoSiiEPM_LDt36GxqUb"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/reddit-cookie" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"token\":\"$MOCK_JWT\",\"csrfToken\":\"abcdef0123456789abcdef0123456789\"}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "reddit-cookie connect (mock valid format → 400 from Reddit)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[8/14] POST /api/connections/mastodon (no accessToken)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/mastodon" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"instance":"mastodon.social"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "mastodon connect (no accessToken)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[9/14] POST /api/connections/mastodon (invalid instance URL)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/mastodon" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"instance":"not a url","accessToken":"valid-length-token-string-1234"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "mastodon connect (invalid instance URL)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[10/14] POST /api/connections/mastodon (valid format, mock creds)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/mastodon" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"instance":"mastodon.social","accessToken":"mock-token-1234567890-abcdef"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "mastodon connect (mock valid format → 400 from Mastodon)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[11/14] POST /api/connections/wordpress (no appPassword)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/wordpress" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"siteUrl":"https://blog.example.com","username":"test"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "wordpress connect (no appPassword)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[12/14] POST /api/connections/wordpress (short appPassword)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/wordpress" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"siteUrl":"https://blog.example.com","username":"test","appPassword":"short"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "wordpress connect (short appPassword)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[13/14] POST /api/connections/wordpress (valid format, mock creds)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/wordpress" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"siteUrl":"https://nonexistent.example","username":"test","appPassword":"abcd wxyz 1234 5678 efgh ijkl mnop qrst uvwx yz01"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "wordpress connect (mock valid format → 400 from WP)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[14/14] DELETE /api/connections/twitter-cookie (no conn)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/api/connections/twitter-cookie" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "disconnect twitter-cookie (no conn)" "404" "$STATUS"
echo ""

echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ curl-tests/new-platforms.sh FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}✅ curl-tests/new-platforms.sh PASSED${NC}"
exit 0
