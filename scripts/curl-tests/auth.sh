#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/auth.sh
# NetAmplify — curl tests for /api/auth/* endpoints.
#
# Run AFTER starting the dev server:
#   pnpm dev:backend   (or)
#   cd apps/backend && pnpm start
#
# Then: bash scripts/curl-tests/auth.sh
#
# Exits 0 if all assertions pass, non-zero on first failure.
# Use this for CI + Phase 7 verification.

set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

# Colours for terminal output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

assert_status() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $label (HTTP $actual)"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗${NC} $label — expected $expected, got $actual"
    FAIL=$((FAIL+1))
  fi
}

assert_field() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $label ($actual)"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗${NC} $label — expected $expected, got $actual"
    FAIL=$((FAIL+1))
  fi
}

assert_contains() {
  local label="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    echo -e "  ${GREEN}✓${NC} $label (contains \"$needle\")"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗${NC} $label — expected to contain \"$needle\", got: $haystack"
    FAIL=$((FAIL+1))
  fi
}

echo -e "${YELLOW}=== NetAmplify Auth curl-tests ===${NC}"
echo "Base URL: $BASE_URL"
echo ""

# Generate unique email per run so duplicate-signup test doesn't fail on reruns
TEST_EMAIL="test_$(date +%s)_$(shuf -i 1-99999 -n 1)@example.com"
TEST_PASSWORD="StrongPass1"
TEST_NAME="Test User"

echo "Using email: $TEST_EMAIL"
echo ""

# --------------------------------------------------------------------
# 1. POST /api/auth/signup — happy path
# --------------------------------------------------------------------
echo -e "${YELLOW}[1/12] POST /api/auth/signup (happy path)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"$TEST_NAME\"}")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n1)
assert_status "signup status" "201" "$STATUS"
assert_contains "signup returns accessToken" "accessToken" "$BODY"
assert_contains "signup returns user.email" "\"email\":\"$TEST_EMAIL\"" "$BODY"
ACCESS_TOKEN=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])" 2>/dev/null || echo "")
USER_ID=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['id'])" 2>/dev/null || echo "")
echo ""

# --------------------------------------------------------------------
# 2. POST /api/auth/signup — duplicate email → 409
# --------------------------------------------------------------------
echo -e "${YELLOW}[2/12] POST /api/auth/signup (duplicate email)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"$TEST_NAME\"}")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n1)
assert_status "duplicate signup status" "409" "$STATUS"
assert_contains "duplicate signup error envelope has code" "\"code\":\"EMAIL_TAKEN\"" "$BODY"
echo ""

# --------------------------------------------------------------------
# 3. POST /api/auth/signup — weak password → 400
# --------------------------------------------------------------------
echo -e "${YELLOW}[3/12] POST /api/auth/signup (weak password)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"weak@example.com\",\"password\":\"weak\",\"name\":\"Weak\"}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "weak password status" "400" "$STATUS"
echo ""

# --------------------------------------------------------------------
# 4. POST /api/auth/signup — malformed email → 400
# --------------------------------------------------------------------
echo -e "${YELLOW}[4/12] POST /api/auth/signup (malformed email)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"not-email\",\"password\":\"$TEST_PASSWORD\",\"name\":\"X\"}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "malformed email status" "400" "$STATUS"
echo ""

# --------------------------------------------------------------------
# 5. POST /api/auth/login — happy path
# --------------------------------------------------------------------
echo -e "${YELLOW}[5/12] POST /api/auth/login (happy path)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n1)
assert_status "login status" "200" "$STATUS"
assert_contains "login returns accessToken" "accessToken" "$BODY"
echo ""

# --------------------------------------------------------------------
# 6. POST /api/auth/login — wrong password → 401
# --------------------------------------------------------------------
echo -e "${YELLOW}[6/12] POST /api/auth/login (wrong password)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"WrongPassword1\"}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "wrong password status" "401" "$STATUS"
echo ""

# --------------------------------------------------------------------
# 7. POST /api/auth/login — non-existent email → 401 (no enumeration)
# --------------------------------------------------------------------
echo -e "${YELLOW}[7/12] POST /api/auth/login (non-existent email)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"nonexistent@example.com\",\"password\":\"$TEST_PASSWORD\"}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "non-existent email status" "401" "$STATUS"
echo ""

# --------------------------------------------------------------------
# 8. GET /api/auth/me — with valid JWT
# --------------------------------------------------------------------
echo -e "${YELLOW}[8/12] GET /api/auth/me (valid JWT)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/auth/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n1)
assert_status "me status" "200" "$STATUS"
assert_contains "me returns user.email" "\"email\":\"$TEST_EMAIL\"" "$BODY"
echo ""

# --------------------------------------------------------------------
# 9. GET /api/auth/me — without JWT → 401
# --------------------------------------------------------------------
echo -e "${YELLOW}[9/12] GET /api/auth/me (no JWT)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/auth/me")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "no-JWT me status" "401" "$STATUS"
echo ""

# --------------------------------------------------------------------
# 10. POST /api/auth/reset-request — for existing email → 204
# --------------------------------------------------------------------
echo -e "${YELLOW}[10/12] POST /api/auth/reset-request (existing email)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/reset-request" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\"}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "reset-request existing email" "204" "$STATUS"
echo ""

# --------------------------------------------------------------------
# 11. POST /api/auth/reset-request — for non-existent email → 204 (no enumeration)
# --------------------------------------------------------------------
echo -e "${YELLOW}[11/12] POST /api/auth/reset-request (non-existent email)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/reset-request" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"nonexistent@example.com\"}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "reset-request non-existent (no enumeration)" "204" "$STATUS"
echo ""

# --------------------------------------------------------------------
# 12. POST /api/auth/reset-confirm — with bogus token → 400
# --------------------------------------------------------------------
echo -e "${YELLOW}[12/12] POST /api/auth/reset-confirm (bogus token)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/reset-confirm" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"bogus-token\",\"newPassword\":\"NewStrong1\"}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "reset-confirm bogus token" "400" "$STATUS"
echo ""

# --------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------
echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ curl-tests/auth.sh FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}✅ curl-tests/auth.sh PASSED${NC}"
exit 0
