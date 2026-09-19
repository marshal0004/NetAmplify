#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/reddit-cookie-live.sh
# NetAmplify — Live test for Reddit cookie-based authentication.
#
# This script tests whether your reddit.com session cookies (token JWT +
# csrf_token) work with Reddit's internal API. Run this on YOUR machine
# (not the sandbox — Reddit blocks cloud IPs).
#
# Usage:
#   REDDIT_TOKEN='<your-token-jwt>' \
#   REDDIT_CSRF='<your-csrf-token>' \
#   bash scripts/curl-tests/reddit-cookie-live.sh
#
# Get your cookies:
#   1. Install Cookie-Editor extension
#   2. Log in to reddit.com
#   3. Click Cookie-Editor icon
#   4. Find the "token" cookie → copy value (long JWT)
#   5. Find the "csrf_token" cookie → copy value (32 hex chars)
#   6. Set them as env vars above (single quotes prevent shell expansion)

set -euo pipefail

if [ -z "${REDDIT_TOKEN:-}" ] || [ -z "${REDDIT_CSRF:-}" ]; then
  echo "ERROR: REDDIT_TOKEN and REDDIT_CSRF env vars must be set."
  echo ""
  echo "Usage:"
  echo "  REDDIT_TOKEN='<your-token-jwt>' \\"
  echo "  REDDIT_CSRF='<your-csrf-token>' \\"
  echo "  bash scripts/curl-tests/reddit-cookie-live.sh"
  echo ""
  echo "Get your cookies from reddit.com via the Cookie-Editor extension:"
  echo "  - token cookie     → REDDIT_TOKEN  (long JWT, ~750 chars)"
  echo "  - csrf_token cookie → REDDIT_CSRF  (32-char hex string)"
  exit 1
fi

PASS=0
FAIL=0
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}=== Reddit Cookie Live Test ===${NC}"
echo ""

# Verify the JWT shape (without exposing the value)
if ! echo "$REDDIT_TOKEN" | grep -qE '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'; then
  echo -e "${RED}✗${NC} REDDIT_TOKEN is not a valid JWT (must have 3 dot-separated parts)"
  exit 1
fi
JWT_LEN=${#REDDIT_TOKEN}
if [ "$JWT_LEN" -lt 100 ]; then
  echo -e "${RED}✗${NC} REDDIT_TOKEN looks too short ($JWT_LEN chars — should be 500+)"
  exit 1
fi
echo -e "${GREEN}✓${NC} REDDIT_TOKEN looks like a valid JWT ($JWT_LEN chars)"
PASS=$((PASS+1))

if [ ${#REDDIT_CSRF} -ne 32 ]; then
  echo -e "${RED}✗${NC} REDDIT_CSRF must be exactly 32 chars (got ${#REDDIT_CSRF})"
  exit 1
fi
if ! echo "$REDDIT_CSRF" | grep -qE '^[a-f0-9]{32}$'; then
  echo -e "${RED}✗${NC} REDDIT_CSRF must be 32 hex chars (0-9, a-f)"
  exit 1
fi
echo -e "${GREEN}✓${NC} REDDIT_CSRF is valid 32-char hex"
PASS=$((PASS+1))
echo ""

# Test 1: Validate credentials via /api/v1/me
echo -e "${YELLOW}[1/3] GET /api/v1/me (validate cookies)${NC}"
RESP=$(curl -s -m 30 -w "\n%{http_code}" \
  -H "Authorization: Bearer $REDDIT_TOKEN" \
  -H "x-CSRF-TOKEN: $REDDIT_CSRF" \
  -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  -H "cookie: token=$REDDIT_TOKEN; csrf_token=$REDDIT_CSRF;" \
  -H "accept: application/json, text/plain, */*" \
  -H "accept-language: en-US,en;q=0.9" \
  -H "origin: https://www.reddit.com" \
  -H "referer: https://www.reddit.com/" \
  "https://www.reddit.com/api/v1/me")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)

if [ "$STATUS" = "200" ]; then
  echo -e "  ${GREEN}✓${NC} HTTP 200 — cookies are valid"
  PASS=$((PASS+1))
  # Extract username + id
  USERNAME=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('name','?'))" 2>/dev/null || echo "?")
  USER_ID=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null || echo "?")
  echo -e "  ${GREEN}✓${NC} Connected as u/${USERNAME} (id: ${USER_ID})"
  PASS=$((PASS+1))
elif [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  echo -e "  ${RED}✗${NC} HTTP $STATUS — cookies rejected. Possible causes:"
  echo "     1. Your IP is blocked by Reddit's anti-bot system (try from a residential IP)"
  echo "     2. Cookies expired or were invalidated (log out + back in to reddit.com)"
  echo "     3. Reddit's session IP-binding rejected the request (log out + in to reissue)"
  FAIL=$((FAIL+1))
else
  echo -e "  ${RED}✗${NC} HTTP $STATUS — unexpected response:"
  echo "     $BODY" | head -3
  FAIL=$((FAIL+1))
fi
echo ""

# Test 2: Post a test submission to r/test (only if test 1 passed)
if [ "$STATUS" = "200" ]; then
  echo -e "${YELLOW}[2/3] POST /api/submit (test post to r/test)${NC}"
  TEST_TITLE="NetAmplify Cookie Test - $(date +%s)"
  RESP=$(curl -s -m 30 -w "\n%{http_code}" \
    -X POST "https://www.reddit.com/api/submit" \
    -H "Authorization: Bearer $REDDIT_TOKEN" \
    -H "x-CSRF-TOKEN: $REDDIT_CSRF" \
    -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
    -H "cookie: token=$REDDIT_TOKEN; csrf_token=$REDDIT_CSRF;" \
    -H "content-type: application/x-www-form-urlencoded" \
    -H "accept: application/json, text/plain, */*" \
    -H "origin: https://www.reddit.com" \
    -H "referer: https://www.reddit.com/" \
    --data-urlencode "api_type=json" \
    --data-urlencode "sr=test" \
    --data-urlencode "kind=self" \
    --data-urlencode "title=$TEST_TITLE" \
    --data-urlencode "text=This is an automated test post from NetAmplify's cookie-based Reddit adapter. Will be deleted shortly.")
  BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)

  if [ "$STATUS" = "200" ]; then
    POST_ID=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('json',{}).get('data',{}).get('id',''))" 2>/dev/null || echo "")
    POST_URL=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('json',{}).get('data',{}).get('url',''))" 2>/dev/null || echo "")
    ERRORS=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); e=d.get('json',{}).get('errors',[]); print(len(e))" 2>/dev/null || echo "?")

    if [ "$ERRORS" = "0" ] && [ -n "$POST_ID" ]; then
      echo -e "  ${GREEN}✓${NC} Post created successfully!"
      echo -e "  ${GREEN}✓${NC} Post ID: $POST_ID"
      echo -e "  ${GREEN}✓${NC} URL: https://www.reddit.com/r/test/comments/${POST_ID}/"
      PASS=$((PASS+1))
    else
      echo -e "  ${RED}✗${NC} Reddit rejected the post ($ERRORS errors):"
      echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('json',{}).get('errors',[]), indent=2))" 2>/dev/null || echo "$BODY"
      FAIL=$((FAIL+1))
    fi
  else
    echo -e "  ${RED}✗${NC} HTTP $STATUS — submit failed"
    echo "     $BODY" | head -3
    FAIL=$((FAIL+1))
  fi
  echo ""
fi

# Test 3: Summary
echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo -e "${RED}❌ Some tests failed.${NC}"
  echo ""
  echo "Most common failure: HTTP 401 from Reddit despite valid cookies."
  echo "Reddit's anti-bot system blocks cloud IPs and some VPNs."
  echo "If you're running this from a residential IP, try:"
  echo "  1. Log out of reddit.com on all devices"
  echo "  2. Log back in (this reissues a fresh session token)"
  echo "  3. Re-export the cookies via Cookie-Editor"
  echo "  4. Run this script again"
  exit 1
fi

echo ""
echo -e "${GREEN}✅ All tests passed. Your Reddit cookies work!${NC}"
echo ""
echo "Next step: connect via NetAmplify"
echo "  1. Start the backend: pnpm dev:backend"
echo "  2. Open http://localhost:4200/dashboard/connections"
echo "  3. Find 'Reddit — Cookie' card"
echo "  4. Paste the token (JWT) and csrf_token values"
echo "  5. Click Connect"
echo ""
echo "⚠️  SECURITY: These cookies are now in your shell history."
echo "   After testing, run: history -c && history -w"
echo "   Or log out of reddit.com to invalidate the session."
exit 0
