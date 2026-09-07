#!/usr/bin/env bash
# /home/z/my-project/netamplify-app/scripts/curl-tests/discord-live.sh
# NetAmplify — Live Discord webhook test.
# Validates the webhook URL + posts a real message to the channel.
# This proves the DiscordAdapter.publish() logic works end-to-end.

set -euo pipefail

WEBHOOK_URL="${1:-${DISCORD_WEBHOOK_URL:-}}"
if [ -z "$WEBHOOK_URL" ]; then
  echo "Usage: bash discord-live.sh <webhook_url>"
  echo "   or: DISCORD_WEBHOOK_URL=... bash discord-live.sh"
  exit 1
fi

PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}=== NetAmplify — Live Discord Webhook Test ===${NC}"
echo ""

# Step 1: Validate the webhook URL (GET returns channel info)
echo -e "${YELLOW}[1/3] Validating webhook URL...${NC}"
VALIDATE_RESP=$(curl -s -w "\n%{http_code}" -X GET "$WEBHOOK_URL")
VALIDATE_BODY=$(echo "$VALIDATE_RESP" | head -n -1)
VALIDATE_STATUS=$(echo "$VALIDATE_RESP" | tail -n1)

if [ "$VALIDATE_STATUS" = "200" ]; then
  CHANNEL_NAME=$(echo "$VALIDATE_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('name','unknown'))" 2>/dev/null || echo "unknown")
  GUILD_ID=$(echo "$VALIDATE_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('guild_id','unknown'))" 2>/dev/null || echo "unknown")
  echo -e "  ${GREEN}✓${NC} Webhook valid — channel: #${CHANNEL_NAME}"
  PASS=$((PASS+1))
else
  echo -e "  ${RED}✗${NC} Webhook validation failed (HTTP $VALIDATE_STATUS)"
  echo "  Body: $VALIDATE_BODY"
  FAIL=$((FAIL+1))
  exit 1
fi
echo ""

# Step 2: Post a real message (embed format — same as DiscordAdapter.publish())
echo -e "${YELLOW}[2/3] Posting test message...${NC}"
PAYLOAD=$(cat <<'ENDJSON'
{
  "embeds": [{
    "title": "Hello World from NetAmplify! 🚀",
    "description": "This is a real test post from NetAmplify — a one-click multi-platform posting app for students. Built with TypeScript, NestJS, React, and Prisma.",
    "url": "https://github.com/marshal0004/NetAmplify",
    "color": 3126795,
    "fields": [
      {
        "name": "Tech Stack",
        "value": "`typescript` `nestjs` `react` `prisma`",
        "inline": false
      },
      {
        "name": "Links",
        "value": "[Repo](https://github.com/marshal0004/NetAmplify) • [Live](https://netamplify.example.com)",
        "inline": false
      }
    ]
  }],
  "username": "NetAmplify"
}
ENDJSON
)

POST_RESP=$(curl -s -w "\n%{http_code}" -X POST "${WEBHOOK_URL}?wait=true" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")
POST_BODY=$(echo "$POST_RESP" | head -n -1)
POST_STATUS=$(echo "$POST_RESP" | tail -n1)

if [ "$POST_STATUS" = "200" ]; then
  MSG_ID=$(echo "$POST_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id','unknown'))" 2>/dev/null || echo "unknown")
  CHANNEL_ID=$(echo "$POST_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('channel_id','unknown'))" 2>/dev/null || echo "unknown")
  echo -e "  ${GREEN}✓${NC} Message posted successfully!"
  echo -e "  Message ID: $MSG_ID"
  echo -e "  Channel ID: $CHANNEL_ID"
  echo -e "  Message URL: https://discord.com/channels/$GUILD_ID/$CHANNEL_ID/$MSG_ID"
  PASS=$((PASS+1))
else
  echo -e "  ${RED}✗${NC} Post failed (HTTP $POST_STATUS)"
  echo "  Body: $POST_BODY"
  FAIL=$((FAIL+1))
fi
echo ""

# Step 3: Summary
echo -e "${YELLOW}=== Summary ===${NC}"
echo -e "  ${GREEN}Pass:${NC} $PASS"
echo -e "  ${RED}Fail:${NC} $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ discord-live.sh FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}✅ discord-live.sh PASSED — check your Discord channel for the message!${NC}"
