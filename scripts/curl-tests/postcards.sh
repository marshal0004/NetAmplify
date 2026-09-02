#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/postcards.sh
# NetAmplify — curl tests for /api/postcards/* endpoints.
#
# Requires a logged-in user. Run AFTER auth.sh:
#   bash scripts/curl-tests/auth.sh
#   bash scripts/curl-tests/postcards.sh

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

TEST_EMAIL="pc_$(date +%s)_$(shuf -i 1-99999 -n 1)@example.com"
TEST_PASSWORD="StrongPass1"
TEST_NAME="PostCard Tester"

echo -e "${YELLOW}=== NetAmplify PostCards curl-tests ===${NC}"
echo "Base URL: $BASE_URL"
echo ""

# 1. Signup to get JWT
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

# 2. GET /api/postcards (empty initial state)
echo -e "${YELLOW}[1/14] GET /api/postcards (empty initial state)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/postcards" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET postcards (empty)" "200" "$STATUS"
assert_contains "response has items array" "\"items\":\[\]" "$BODY"
echo ""

# 3. GET /api/postcards without JWT → 401
echo -e "${YELLOW}[2/14] GET /api/postcards (no JWT → 401)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/postcards")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "no-JWT postcards" "401" "$STATUS"
echo ""

# 4. POST /api/postcards (create with valid input)
echo -e "${YELLOW}[3/14] POST /api/postcards (valid input)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/postcards" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"title":"My Test Project","summary":"A one-line summary","description":"A longer markdown description","techStack":["TypeScript","React"],"repoUrl":"https://github.com/user/repo","liveUrl":"https://example.com"}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
assert_status "POST postcards (valid)" "201" "$STATUS"
assert_contains "returns postcard id" "\"id\":\"" "$BODY"
assert_contains "returns title" "\"title\":\"My Test Project\"" "$BODY"
POSTCARD_ID=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
echo "  (PostCard ID: $POSTCARD_ID)"
echo ""

# 5. POST /api/postcards (missing required fields → 400)
echo -e "${YELLOW}[4/14] POST /api/postcards (missing title)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/postcards" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"summary":"missing title","description":"body","techStack":["a"]}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "POST postcards (missing title)" "400" "$STATUS"
echo ""

# 6. POST /api/postcards (empty techStack → 400)
echo -e "${YELLOW}[5/14] POST /api/postcards (empty techStack)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/postcards" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"title":"T","summary":"S","description":"D","techStack":[]}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "POST postcards (empty techStack)" "400" "$STATUS"
echo ""

# 7. POST /api/postcards (>10 techStack → 400)
echo -e "${YELLOW}[6/14] POST /api/postcards (>10 techStack)${NC}"
TOO_MANY='["a","b","c","d","e","f","g","h","i","j","k"]'
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/postcards" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"title\":\"T\",\"summary\":\"S\",\"description\":\"D\",\"techStack\":$TOO_MANY}")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "POST postcards (>10 techStack)" "400" "$STATUS"
echo ""

# 8. GET /api/postcards/:id (existing postcard)
echo -e "${YELLOW}[7/14] GET /api/postcards/:id (existing)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/postcards/$POSTCARD_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET postcard by id" "200" "$STATUS"
assert_contains "returns title" "\"title\":\"My Test Project\"" "$BODY"
echo ""

# 9. GET /api/postcards/:id (nonexistent → 404)
echo -e "${YELLOW}[8/14] GET /api/postcards/:id (nonexistent)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/postcards/nonexistent-id" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET nonexistent postcard" "404" "$STATUS"
echo ""

# 10. PATCH /api/postcards/:id (partial update)
echo -e "${YELLOW}[9/14] PATCH /api/postcards/:id (partial update)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE_URL/api/postcards/$POSTCARD_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"title":"Updated Title"}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
assert_status "PATCH postcard" "200" "$STATUS"
assert_contains "title is updated" "\"title\":\"Updated Title\"" "$BODY"
echo ""

# 11. PATCH /api/postcards/:id (nonexistent → 404)
echo -e "${YELLOW}[10/14] PATCH /api/postcards/:id (nonexistent)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE_URL/api/postcards/nonexistent-id" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"title":"X"}')
STATUS=$(echo "$RESP" | tail -n1)
assert_status "PATCH nonexistent postcard" "404" "$STATUS"
echo ""

# 12. GET /api/postcards/:id/preview (Reddit platform)
echo -e "${YELLOW}[11/14] GET /api/postcards/:id/preview?platform=REDDIT${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/postcards/$POSTCARD_ID/preview?platform=REDDIT&subreddit=test" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET preview REDDIT" "200" "$STATUS"
assert_contains "preview has formatted body" "\"body\":" "$BODY"
echo ""

# 13. GET /api/postcards/:id/preview (Twitter/X platform)
echo -e "${YELLOW}[12/14] GET /api/postcards/:id/preview?platform=TWITTER${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/postcards/$POSTCARD_ID/preview?platform=TWITTER" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET preview TWITTER" "200" "$STATUS"
echo ""

# 14. GET /api/postcards/:id/preview (unknown platform → 400)
echo -e "${YELLOW}[13/14] GET /api/postcards/:id/preview?platform=INSTAGRAM (unknown)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/postcards/$POSTCARD_ID/preview?platform=INSTAGRAM" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "GET preview unknown platform" "400" "$STATUS"
echo ""

# 15. DELETE /api/postcards/:id (existing)
echo -e "${YELLOW}[14/14] DELETE /api/postcards/:id (existing)${NC}"
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/api/postcards/$POSTCARD_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "DELETE postcard" "204" "$STATUS"

# Verify delete worked — subsequent GET returns 404
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/postcards/$POSTCARD_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
STATUS=$(echo "$RESP" | tail -n1)
assert_status "post-deletion GET returns 404" "404" "$STATUS"
echo ""

# Summary
echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ curl-tests/postcards.sh FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}✅ curl-tests/postcards.sh PASSED${NC}"
exit 0
