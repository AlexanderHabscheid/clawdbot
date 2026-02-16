# Centris AI - Cloudflare Workers Integration

This directory contains the Cloudflare Workers and AI Gateway integration for Centris AI, providing:

- **Command Cache**: Instant responses for common voice commands (0ms latency)
- **LLM Caching**: Semantic caching via AI Gateway (30-50% cost reduction)
- **Transcription Caching**: Cache identical audio transcriptions
- **Multi-Provider Support**: DeepSeek, OpenAI, Anthropic, Gemini with automatic failover

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Centris Backend                                │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┴───────────────────────┐
        │                                               │
        ▼                                               ▼
┌───────────────────┐                     ┌─────────────────────────────┐
│  Workers Gateway  │                     │    Cloudflare AI Gateway    │
│  (centris-gateway)│                     │  (centris-ai-gateway)       │
├───────────────────┤                     ├─────────────────────────────┤
│ ✓ Command cache   │                     │ ✓ Semantic LLM caching      │
│ ✓ Transcription   │                     │ ✓ Request analytics         │
│ ✓ Request routing │                     │ ✓ Rate limiting             │
│ ✓ KV caching      │                     │ ✓ Provider failover         │
└───────────────────┘                     └─────────────────────────────┘
        │                                               │
        ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         LLM Providers                                 │
│   DeepSeek  │  OpenAI  │  Anthropic  │  Google Gemini                │
└──────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Deploy the Workers Gateway

```bash
cd centris-gateway
npm install
wrangler login
wrangler deploy
```

### 2. Create AI Gateway in Cloudflare Dashboard

1. Go to: https://dash.cloudflare.com/YOUR_ACCOUNT_ID/ai/ai-gateway
2. Click **Create Gateway**
3. Configure:
   - **Name**: centris-ai-gateway
   - **Slug**: centris-ai-gateway
4. Enable:
   - ✅ **Caching** (Cache TTL: 3600 seconds)
   - ✅ **Request Logging**
   - ✅ **Analytics**
   - ⚠️ **Rate Limiting**: 100 requests/minute

### 3. Add Environment Variables

Add these to your `.env` file:

```bash
# Cloudflare AI Gateway Configuration
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
CLOUDFLARE_AI_GATEWAY_SLUG=centris-ai-gateway
CLOUDFLARE_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/YOUR_ACCOUNT_ID/centris-ai-gateway

# Enable AI Gateway routing
USE_AI_GATEWAY=true

# Workers Gateway URL
CLOUDFLARE_GATEWAY_URL=https://centris-gateway.YOUR_SUBDOMAIN.workers.dev
USE_CLOUDFLARE_GATEWAY=true
CLOUDFLARE_CACHE_ENABLED=true
```

Or run the setup script:

```bash
./scripts/setup-ai-gateway.sh
cat .env.aigateway >> ../.env
```

## Endpoints

### Workers Gateway (centris-gateway.a-7cd.workers.dev)

| Endpoint                 | Method | Description                               |
| ------------------------ | ------ | ----------------------------------------- |
| `/health`                | GET    | Health check                              |
| `/api/command`           | POST   | Command cache lookup                      |
| `/api/chat`              | POST   | LLM chat completion (with caching)        |
| `/api/transcribe`        | POST   | Audio transcription (with caching)        |
| `/api/stats`             | GET    | Cache statistics                          |
| `/api/patterns/search`   | POST   | Semantic search for complex task patterns |
| `/api/patterns/list`     | GET    | List all available task patterns          |
| `/api/patterns/populate` | POST   | Populate Vectorize index (admin)          |

### AI Gateway Endpoints

| Provider  | Endpoint                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek  | `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_slug}/deepseek/chat/completions`                              |
| OpenAI    | `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_slug}/openai/chat/completions`                                |
| Anthropic | `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_slug}/anthropic/messages`                                     |
| Gemini    | `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_slug}/google-ai-studio/v1beta/models/{model}:generateContent` |

## Testing

### Test Command Cache (Instant Response)

```bash
curl -X POST https://centris-gateway.a-7cd.workers.dev/api/command \
  -H "Content-Type: application/json" \
  -d '{"command": "go to gmail"}'

# Response (0ms):
# {"matched":true,"command":{"action":"navigate","url":"https://mail.google.com"},"confidence":1,"cached":true,"latency_ms":0}
```

### Test LLM Chat (with Caching)

```bash
curl -X POST https://centris-gateway.a-7cd.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}],"model":"deepseek-chat","provider":"deepseek","temperature":0}'
```

### Test Cache Stats

```bash
curl https://centris-gateway.a-7cd.workers.dev/api/stats
```

### Test Pattern Search (Complex Task Matching)

```bash
curl -X POST https://centris-gateway.a-7cd.workers.dev/api/patterns/search \
  -H "Content-Type: application/json" \
  -d '{"intent": "I need to compare prices for AirPods across Amazon and Best Buy"}'

# Response:
# {
#   "success": true,
#   "query": "I need to compare prices for AirPods across Amazon and Best Buy",
#   "matches": [
#     {"id": "compare-products-multiple-sites", "score": 0.92, "category": "research", ...}
#   ],
#   "matchCount": 1
# }
```

### List All Task Patterns

```bash
curl https://centris-gateway.a-7cd.workers.dev/api/patterns/list
```

## Python Integration

The `CloudflareGateway` client is automatically used by Centris when `USE_AI_GATEWAY=true`:

```python
from backend.utils.cloudflare_gateway import get_cloudflare_gateway

# Get gateway client
gateway = get_cloudflare_gateway()

# Check command cache (instant response)
cached = await gateway.check_command_cache("go to gmail")
if cached:
    return cached  # Action without LLM call

# Route LLM through AI Gateway (semantic caching)
response = await gateway.chat_completion_via_ai_gateway(
    messages=[{"role": "user", "content": "Hello"}],
    model="deepseek-chat",
    provider="deepseek",
)
```

Or use the AI Gateway-aware LLM provider:

```python
from backend.llm.ai_gateway_provider import get_ai_gateway_provider

# Get provider with AI Gateway routing
provider = get_ai_gateway_provider("deepseek")
response = provider.chat([{"role": "user", "content": "Hello!"}])

# Check cache stats
stats = provider.get_cache_stats()
print(f"Cache hit rate: {stats['hit_rate']:.1%}")
```

## Cost Savings

| Optimization                | Savings                 |
| --------------------------- | ----------------------- |
| Command Cache               | 100% (no LLM call)      |
| AI Gateway Semantic Caching | 30-50%                  |
| DeepSeek Prefix Caching     | 90% on cache hits       |
| **Combined**                | **Up to 95% reduction** |

### Monthly Cost Projections (100k users)

| Scenario         | Without Gateway | With Gateway | Savings        |
| ---------------- | --------------- | ------------ | -------------- |
| LLM API Costs    | $25,375/mo      | $15,225/mo   | $10,150 (40%)  |
| Cloudflare Costs | $0              | $67/mo       | -              |
| **Total**        | $25,375/mo      | $15,292/mo   | **$10,083/mo** |

## Monitoring

### Cloudflare Dashboard

- **Workers Analytics**: Request count, CPU time, errors
  https://dash.cloudflare.com/YOUR_ACCOUNT_ID/workers/analytics

- **AI Gateway Analytics**: Cache hit rate, provider usage, costs
  https://dash.cloudflare.com/YOUR_ACCOUNT_ID/ai/ai-gateway/centris-ai-gateway

### Alerts

Configure alerts for:

- Cost spike > $500/day
- Error rate > 5%
- Cache hit rate < 30%
- Rate limit hits

## Files

```
cloudflare-workers/
├── centris-gateway/
│   ├── src/
│   │   ├── index.js          # Main Worker code
│   │   └── command-cache.js  # Command cache mappings
│   ├── wrangler.toml         # Worker configuration
│   └── package.json
├── scripts/
│   └── setup-ai-gateway.sh   # AI Gateway setup script
└── README.md                 # This file
```

## Troubleshooting

### Gateway Not Caching

1. Check `USE_AI_GATEWAY=true` in `.env`
2. Verify AI Gateway is created in dashboard
3. Check cache TTL is set correctly
4. For deterministic caching, use `temperature=0`

### High Latency

1. Check if hitting API directly (gateway bypass)
2. Verify KV namespace is configured
3. Check provider rate limits

### Rate Limit Errors

1. Increase rate limit in AI Gateway settings
2. Implement request queuing in backend
3. Add provider failover

## Contributing

When modifying the Worker:

1. Test locally: `wrangler dev`
2. Deploy to staging: `wrangler deploy --env=staging`
3. Deploy to production: `wrangler deploy`
