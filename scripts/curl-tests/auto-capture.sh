#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/auto-capture.sh
# NetAmplify — curl tests for the POST /api/connections/:platform/auto-capture endpoint.
#
# This endpoint is called by the Tauri desktop app after it captures
# cookies from the native WebView login window. The Tauri app sends
# the cookies as a JSON object, and the backend maps them to the
# adapter's expected input fields + validates + stores them.
#
# These tests verify:
#   - The endpoint accepts the cookie map format from Tauri
#   - Zod validation rejects malformed inputs (missing cookies, wrong format)
#   - JWT authentication is enforced
#   - Non-cookie platforms are rejected (only TWITTER_COOKIE + REDDIT_COOKIE)
#
# Usage: bash scripts/curl-tests/auto-capture.sh

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

# Generate a mock JWT that passes Zod validation (≥100 chars, 3 dot-separated parts)
MOCK_JWT="eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LWZvci10ZXN0aW5nLXB1cnBvc2VzLW9ubHktbm90LWEtcmVhbC1rZXkifQ.eyJzdWIiOiJ1c2VyIiwiZXhwIjoxODA1MjA4MjUxLCJsaWQiOiJ0Ml90ZXN0MTIzIiwiY2lkIjoiMFItV0FNaHVvby1NeVEiLCJzY3AiOiJzdWJtaXQifQ.dGhpcy1pcy1hLWZha2Utc2lnbmF0dXJlLWZvci10ZXN0aW5nLXB1cnBvc2VzLW9ubHktbm90LWEtcmVhbC1zaWduYXR1cmUtdGhpcy1pcy1sb25nLWVub3VnaC10by1wYXNzLXRoZS0xMDAtY2hhci1taW5pbXVtLXZhbGlkYXRpb24"
MOCK_CSRF="abcdef0123456789abcdef0123456789"
MOCK_AUTH_TOKEN="$(printf 'a%.0s' {1..40})"
MOCK_CT0="$(printf 'b%.0s' {1..32})"

TEST_EMAIL="ac_$(date +%s)_$(shuf -i 1-99999 -n 1)@example.com"
TEST_PASSWORD="StrongPass1"

echo -e "${YELLOW}=== NetAmplify Auto-Capture curl-tests ===${NC}"
echo "Base URL: $BASE_URL"
echo ""

# Signup to get JWT
echo -e "${YELLOW}[setup] signup${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"Test\"}")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
if [ "$STATUS" = "201" ]; then
  ACCESS_TOKEN=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])" 2>/dev/null)
  echo -e "  ${GREEN}✓${NC} signup → got JWT"
else
  echo -e "${RED}FAILED:${NC} signup returned $STATUS"; exit 1
fi
echo ""

echo -e "${YELLOW}[1/8] POST /api/connections/reddit-cookie/auto-capture (valid format, mock creds)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/reddit-cookie/auto-capture" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"cookies\":{\"token_v2\":\"$MOCK_JWT\",\"csrf_token\":\"$MOCK_CSRF\"}}")
STATUS=$(echo "$RESP" | tail -n1)
# Expected: 400 (mock JWT → Reddit API rejects with AUTH → mapped to 400)
assert_status "reddit-cookie auto-capture (mock creds → 400 from Reddit)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[2/8] POST /api/connections/reddit-cookie/auto-capture (missing cookies object)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/reddit-cookie/auto-capture" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "reddit-cookie auto-capture (no cookies object)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[3/8] POST /api/connections/reddit-cookie/auto-capture (missing token_v2)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/reddit-cookie/auto-capture" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"cookies\":{\"csrf_token\":\"$MOCK_CSRF\"}}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "reddit-cookie auto-capture (no token_v2)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[4/8] POST /api/connections/reddit-cookie/auto-capture (no JWT → 401)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/reddit-cookie/auto-capture" \
  -H "Content-Type: application/json" \
  -d "{\"cookies\":{\"token_v2\":\"$MOCK_JWT\",\"csrf_token\":\"$MOCK_CSRF\"}}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "reddit-cookie auto-capture (no JWT)" "401" "$STATUS"
echo ""

echo -e "${YELLOW}[5/8] POST /api/connections/twitter-cookie/auto-capture (valid format, mock creds)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/twitter-cookie/auto-capture" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"cookies\":{\"auth_token\":\"$MOCK_AUTH_TOKEN\",\"ct0\":\"$MOCK_CT0\"}}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "twitter-cookie auto-capture (mock creds → 400 from X)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[6/8] POST /api/connections/twitter-cookie/auto-capture (missing auth_token)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/twitter-cookie/auto-capture" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"cookies\":{\"ct0\":\"$MOCK_CT0\"}}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "twitter-cookie auto-capture (no auth_token)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[7/8] POST /api/connections/devto/auto-capture (non-cookie platform → 400)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/devto/auto-capture" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"cookies":{"apiKey":"test"}}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "devto auto-capture (non-cookie platform)" "400" "$STATUS"
echo ""

echo -e "${YELLOW}[8/8] POST /api/connections/unknown/auto-capture (unknown platform → 400)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/connections/unknown/auto-capture" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"cookies":{}}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "unknown platform auto-capture" "400" "$STATUS"
echo ""

echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ curl-tests/auto-capture.sh FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}✅ curl-tests/auto-capture.sh PASSED${NC}"
exit 0
