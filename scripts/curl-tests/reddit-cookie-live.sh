#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/reddit-cookie-live.sh
# NetAmplify — Live test for Reddit cookie-based authentication.
#
# This script tests whether your reddit.com session cookies (token_v2 JWT +
# csrf_token + optional token) work with Reddit's internal API.
# Run this on YOUR machine (not the sandbox — Reddit blocks cloud IPs).
#
# Usage:
#   REDDIT_TOKEN_V2='<your-token_v2-jwt>' \
#   REDDIT_CSRF='<your-csrf-token>' \
#   [REDDIT_TOKEN_LEGACY='<your-legacy-token-jwt>'] \
#   bash scripts/curl-tests/reddit-cookie-live.sh
#
# Get your cookies:
#   1. Install Cookie-Editor extension (https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhonkehodjpanfjoadhacee)
#   2. Log in to reddit.com
#   3. Click Cookie-Editor icon
#   4. Find the "token_v2" cookie → copy value (long JWT, ~1500+ chars) → REDDIT_TOKEN_V2
#   5. Find the "csrf_token" cookie → copy value (32 hex chars) → REDDIT_CSRF
#   6. Find the "token" cookie (legacy, optional) → copy value → REDDIT_TOKEN_LEGACY
#
# Cookie lifetimes:
#   - token_v2: 1-2 days (refreshed automatically by reddit.com when user browses)
#   - csrf_token: 1-2 days (rotates with token_v2)
#   - token (legacy): ~6 months (long-lived fallback, has no scopes alone)
#
# If token_v2 has expired (HTTP 401 from Reddit), open reddit.com in your
# browser, refresh the page, then re-export the cookies — the browser will
# have received a fresh token_v2 automatically.

set -euo pipefail

if [ -z "${REDDIT_TOKEN_V2:-}" ] || [ -z "${REDDIT_CSRF:-}" ]; then
  echo "ERROR: REDDIT_TOKEN_V2 and REDDIT_CSRF env vars must be set."
  echo ""
  echo "Usage:"
  echo "  REDDIT_TOKEN_V2='<your-token_v2-jwt>' \\"
  echo "  REDDIT_CSRF='<your-csrf-token>' \\"
  echo "  [REDDIT_TOKEN_LEGACY='<your-legacy-token-jwt>'] \\"
  echo "  bash scripts/curl-tests/reddit-cookie-live.sh"
  echo ""
  echo "Get your cookies from reddit.com via the Cookie-Editor extension:"
  echo "  - token_v2 cookie  → REDDIT_TOKEN_V2        (REQUIRED, long JWT, ~1500+ chars)"
  echo "  - csrf_token cookie → REDDIT_CSRF            (REQUIRED, 32-char hex string)"
  echo "  - token cookie     → REDDIT_TOKEN_LEGACY    (OPTIONAL, legacy JWT, ~500-2000 chars)"
  exit 1
fi

PASS=0
FAIL=0
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}=== Reddit Cookie Live Test (modern token_v2 auth flow) ===${NC}"
echo ""

# Validate REDDIT_TOKEN_V2 (JWT format)
if ! echo "$REDDIT_TOKEN_V2" | grep -qE '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'; then
  echo -e "${RED}✗${NC} REDDIT_TOKEN_V2 is not a valid JWT (must have 3 dot-separated parts)"
  exit 1
fi
V2_LEN=${#REDDIT_TOKEN_V2}
if [ "$V2_LEN" -lt 100 ]; then
  echo -e "${RED}✗${NC} REDDIT_TOKEN_V2 looks too short ($V2_LEN chars — should be 1500+)"
  exit 1
fi
echo -e "${GREEN}✓${NC} REDDIT_TOKEN_V2 looks like a valid JWT ($V2_LEN chars)"
PASS=$((PASS+1))

# Decode the JWT payload to show the user id + expiry
JWT_PAYLOAD=$(echo "$REDDIT_TOKEN_V2" | cut -d'.' -f2)
# Pad to multiple of 4
PADDING=$(( (4 - ${#JWT_PAYLOAD} % 4) % 4 ))
JWT_PAYLOAD_PADDED="${JWT_PAYLOAD}$(printf '=%.0s' $(seq 1 $PADDING))"
USER_ID=$(echo "$JWT_PAYLOAD_PADDED" | base64 -d 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('lid', d.get('sub', '?')))
except Exception:
    print('?')
" 2>/dev/null || echo "?")
EXP_TS=$(echo "$JWT_PAYLOAD_PADDED" | base64 -d 2>/dev/null | python3 -c "
import json, sys, datetime
try:
    d = json.load(sys.stdin)
    exp = d.get('exp', 0)
    if exp > 0:
        days_left = (exp - $(date +%s)) / 86400
        print(f'{datetime.datetime.fromtimestamp(exp).isoformat()} ({days_left:.1f} days left)')
    else:
        print('unknown')
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")
echo -e "  User ID (lid): ${GREEN}${USER_ID}${NC}"
echo -e "  Expires: ${YELLOW}${EXP_TS}${NC}"
if echo "$EXP_TS" | grep -qE 'days left'; then
  DAYS=$(echo "$EXP_TS" | grep -oE '[0-9]+\.[0-9]+ days left' | grep -oE '^[0-9]+\.[0-9]+')
  if [ "$(echo "$DAYS < 1.0" | bc -l 2>/dev/null || echo 0)" = "1" ]; then
    echo -e "  ${RED}⚠️  token_v2 expires in less than 1 day! Refresh by browsing reddit.com${NC}"
  fi
fi

# Validate REDDIT_CSRF (32-char hex)
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

# Optional legacy token
LEGACY_COOKIE_PART=""
if [ -n "${REDDIT_TOKEN_LEGACY:-}" ]; then
  if ! echo "$REDDIT_TOKEN_LEGACY" | grep -qE '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'; then
    echo -e "${YELLOW}⚠${NC} REDDIT_TOKEN_LEGACY is not a valid JWT — will skip legacy cookie"
  else
    LEGACY_COOKIE_PART="; token=$REDDIT_TOKEN_LEGACY"
    echo -e "${GREEN}✓${NC} REDDIT_TOKEN_LEGACY provided (will include legacy cookie)"
    PASS=$((PASS+1))
  fi
fi
echo ""

# Test 1: Validate credentials via /api/v1/me
echo -e "${YELLOW}[1/3] GET /api/v1/me (validate cookies)${NC}"
RESP=$(curl -s -m 30 -w "\n%{http_code}" \
  -H "Authorization: Bearer $REDDIT_TOKEN_V2" \
  -H "x-CSRF-TOKEN: $REDDIT_CSRF" \
  -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  -H "cookie: token_v2=$REDDIT_TOKEN_V2; csrf_token=$REDDIT_CSRF${LEGACY_COOKIE_PART};" \
  -H "accept: application/json, text/plain, */*" \
  -H "accept-language: en-US,en;q=0.9" \
  -H "origin: https://www.reddit.com" \
  -H "referer: https://www.reddit.com/" \
  "https://www.reddit.com/api/v1/me")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)

if [ "$STATUS" = "200" ]; then
  echo -e "  ${GREEN}✓${NC} HTTP 200 — cookies are valid"
  PASS=$((PASS+1))
  USERNAME=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('name','?'))" 2>/dev/null || echo "?")
  USER_ID_FROM_API=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','?'))" 2>/dev/null || echo "?")
  echo -e "  ${GREEN}✓${NC} Connected as u/${USERNAME} (id: ${USER_ID_FROM_API})"
  PASS=$((PASS+1))
elif [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  echo -e "  ${RED}✗${NC} HTTP $STATUS — cookies rejected. Possible causes:"
  echo "     1. Your IP is blocked by Reddit's anti-bot system (cloud IPs / VPNs)"
  echo "     2. token_v2 has expired (lasts 1-2 days — browse reddit.com to refresh)"
  echo "     3. Cookies copied incorrectly (check token_v2 has 3 dot-separated parts)"
  echo "     4. Reddit's session IP-binding rejected the request"
  echo ""
  echo "  Response body (first 200 chars):"
  echo "  $BODY" | head -c 200
  FAIL=$((FAIL+1))
else
  echo -e "  ${RED}✗${NC} HTTP $STATUS — unexpected response:"
  echo "     $BODY" | head -c 300
  FAIL=$((FAIL+1))
fi
echo ""

# Test 2: Post a test submission to r/test (only if test 1 passed)
if [ "$STATUS" = "200" ]; then
  echo -e "${YELLOW}[2/3] POST /api/submit (test post to r/test)${NC}"
  TEST_TITLE="NetAmplify Cookie Test - $(date +%s)"
  RESP=$(curl -s -m 30 -w "\n%{http_code}" \
    -X POST "https://www.reddit.com/api/submit" \
    -H "Authorization: Bearer $REDDIT_TOKEN_V2" \
    -H "x-CSRF-TOKEN: $REDDIT_CSRF" \
    -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
    -H "cookie: token_v2=$REDDIT_TOKEN_V2; csrf_token=$REDDIT_CSRF${LEGACY_COOKIE_PART};" \
    -H "content-type: application/x-www-form-urlencoded" \
    -H "accept: application/json, text/plain, */*" \
    -H "origin: https://www.reddit.com" \
    -H "referer: https://www.reddit.com/" \
    --data-urlencode "api_type=json" \
    --data-urlencode "sr=test" \
    --data-urlencode "kind=self" \
    --data-urlencode "title=$TEST_TITLE" \
    --data-urlencode "text=This is an automated test post from NetAmplify's cookie-based Reddit adapter.")
  BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -n1)

  if [ "$STATUS" = "200" ]; then
    POST_ID=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('json',{}).get('data',{}).get('id',''))" 2>/dev/null || echo "")
    ERRORS=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); e=d.get('json',{}).get('errors',[]); print(len(e))" 2>/dev/null || echo "?")

    if [ "$ERRORS" = "0" ] && [ -n "$POST_ID" ]; then
      echo -e "  ${GREEN}✓${NC} Post created successfully!"
      echo -e "  ${GREEN}✓${NC} Post ID: $POST_ID"
      echo -e "  ${GREEN}✓${NC} URL: https://www.reddit.com/r/test/comments/${POST_ID}/"
      PASS=$((PASS+1))
    else
      echo -e "  ${RED}✗${NC} Reddit rejected the post ($ERRORS errors):"
      echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('json',{}).get('errors',[]), indent=2))" 2>/dev/null || echo "$BODY" | head -c 300
      FAIL=$((FAIL+1))
    fi
  else
    echo -e "  ${RED}✗${NC} HTTP $STATUS — submit failed"
    echo "  $BODY" | head -c 300
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
  echo "Most common failure: HTTP 401/403 from Reddit despite valid cookies."
  echo "Reddit's anti-bot system blocks cloud IPs and some VPNs."
  echo "If you're running this from a residential IP, try:"
  echo "  1. Open reddit.com in your browser"
  echo "  2. Refresh the page (Reddit issues a fresh token_v2 automatically)"
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
echo "  4. Paste token_v2 + csrf_token (required) and token (optional)"
echo "  5. Click Connect"
echo ""
echo "⚠️  SECURITY: These cookies are now in your shell history."
echo "   After testing, run: history -c && history -w"
echo "   Or log out of reddit.com to invalidate the session."
exit 0
