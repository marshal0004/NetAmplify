#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/platforms-live.sh
# NetAmplify — Live platform integration test for all 4 working platforms.
# Tests Discord, Dev.to, Telegram, and LinkedIn by posting REAL content.
# Set credentials via environment variables before running.

set -euo pipefail

PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Credentials from environment variables (or .env file)
DISCORD_WEBHOOK="${DISCORD_WEBHOOK:-}"
DEVTO_API_KEY="${DEVTO_API_KEY:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHANNEL="${TELEGRAM_CHANNEL:-@netamplify_test}"
LINKEDIN_ACCESS_TOKEN="${LINKEDIN_ACCESS_TOKEN:-}"

echo -e "${YELLOW}=== NetAmplify — Live Platform Integration Tests ===${NC}"
echo "Testing all 4 working platforms with REAL API calls."
echo ""

# ============================================================================
# 1. DISCORD
# ============================================================================
if [ -n "$DISCORD_WEBHOOK" ]; then
  echo -e "${YELLOW}[1/4] Discord — Posting to webhook...${NC}"
  DISCORD_PAYLOAD='{"embeds":[{"title":"NetAmplify Demo Test","description":"Live curl-test from NetAmplify. DiscordAdapter works.","color":3126795,"fields":[{"name":"Tech","value":"typescript nestjs"}]}],"username":"NetAmplify"}'
  DISCORD_RESP=$(curl -s -w "\n%{http_code}" -X POST "${DISCORD_WEBHOOK}?wait=true" -H "Content-Type: application/json" -d "$DISCORD_PAYLOAD")
  DISCORD_STATUS=$(echo "$DISCORD_RESP" | tail -n1)
  if [ "$DISCORD_STATUS" = "200" ]; then
    echo -e "  ${GREEN}✓ Discord: Message posted (HTTP 200)${NC}"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗ Discord: Failed (HTTP $DISCORD_STATUS)${NC}"
    FAIL=$((FAIL+1))
  fi
else
  echo -e "${YELLOW}[1/4] Discord: Skipped (DISCORD_WEBHOOK not set)${NC}"
fi
echo ""

# ============================================================================
# 2. DEV.TO
# ============================================================================
if [ -n "$DEVTO_API_KEY" ]; then
  echo -e "${YELLOW}[2/4] Dev.to — Publishing article...${NC}"
  DEVTO_PAYLOAD='{"article":{"title":"NetAmplify Live Test","body_markdown":"Live curl-test from NetAmplify. DevtoAdapter works.","tags":["netamplify","test"],"published":true}}'
  DEVTO_RESP=$(curl -s -w "\n%{http_code}" -X POST "https://dev.to/api/articles" -H "api-key: ${DEVTO_API_KEY}" -H "Content-Type: application/json" -d "$DEVTO_PAYLOAD")
  DEVTO_STATUS=$(echo "$DEVTO_RESP" | tail -n1)
  if [ "$DEVTO_STATUS" = "201" ]; then
    echo -e "  ${GREEN}✓ Dev.to: Article published (HTTP 201)${NC}"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗ Dev.to: Failed (HTTP $DEVTO_STATUS)${NC}"
    FAIL=$((FAIL+1))
  fi
else
  echo -e "${YELLOW}[2/4] Dev.to: Skipped (DEVTO_API_KEY not set)${NC}"
fi
echo ""

# ============================================================================
# 3. TELEGRAM
# ============================================================================
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  echo -e "${YELLOW}[3/4] Telegram — Sending message to channel...${NC}"
  TELEGRAM_RESP=$(curl -s -w "\n%{http_code}" -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" -d "chat_id=${TELEGRAM_CHANNEL}" -d "text=NetAmplify Live Test — TelegramAdapter works." -d "parse_mode=HTML")
  TELEGRAM_STATUS=$(echo "$TELEGRAM_RESP" | tail -n1)
  if [ "$TELEGRAM_STATUS" = "200" ]; then
    echo -e "  ${GREEN}✓ Telegram: Message sent (HTTP 200)${NC}"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗ Telegram: Failed (HTTP $TELEGRAM_STATUS)${NC}"
    FAIL=$((FAIL+1))
  fi
else
  echo -e "${YELLOW}[3/4] Telegram: Skipped (TELEGRAM_BOT_TOKEN not set)${NC}"
fi
echo ""

# ============================================================================
# 4. LINKEDIN
# ============================================================================
if [ -n "$LINKEDIN_ACCESS_TOKEN" ]; then
  echo -e "${YELLOW}[4/4] LinkedIn — Posting to feed...${NC}"
  LINKEDIN_ME=$(curl -s -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}" "https://api.linkedin.com/v2/userinfo")
  MEMBER_ID=$(echo "$LINKEDIN_ME" | python3 -c "import json,sys; print(json.load(sys.stdin).get('sub',''))" 2>/dev/null || echo "")
  if [ -z "$MEMBER_ID" ]; then
    echo -e "  ${RED}✗ LinkedIn: Could not get member ID (token expired)${NC}"
    FAIL=$((FAIL+1))
  else
    LINKEDIN_PAYLOAD="{\"author\":\"urn:li:person:${MEMBER_ID}\",\"lifecycleState\":\"PUBLISHED\",\"specificContent\":{\"com.linkedin.ugc.ShareContent\":{\"shareCommentary\":{\"text\":\"NetAmplify Live Test — LinkedInAdapter works. #netamplify\"},\"shareMediaCategory\":\"NONE\"}},\"visibility\":{\"com.linkedin.ugc.MemberNetworkVisibility\":\"PUBLIC\"}}"
    LINKEDIN_RESP=$(curl -s -w "\n%{http_code}" -X POST "https://api.linkedin.com/v2/ugcPosts" -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}" -H "Content-Type: application/json" -H "X-Restli-Protocol-Version: 2.0.0" -d "$LINKEDIN_PAYLOAD")
    LINKEDIN_STATUS=$(echo "$LINKEDIN_RESP" | tail -n1)
    if [ "$LINKEDIN_STATUS" = "201" ]; then
      echo -e "  ${GREEN}✓ LinkedIn: Post published (HTTP 201)${NC}"
      PASS=$((PASS+1))
    else
      echo -e "  ${RED}✗ LinkedIn: Failed (HTTP $LINKEDIN_STATUS)${NC}"
      FAIL=$((FAIL+1))
    fi
  fi
else
  echo -e "${YELLOW}[4/4] LinkedIn: Skipped (LINKEDIN_ACCESS_TOKEN not set)${NC}"
fi
echo ""

# ============================================================================
# Summary
# ============================================================================
echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ Some platforms failed${NC}"
  exit 1
fi
echo -e "${GREEN}✅ All platforms PASSED${NC}"
exit 0
