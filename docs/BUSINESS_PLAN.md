# Centris AI Business Plan

**February 2026**

---

## 1. Executive Summary

**Company:** Centris AI

**One-liner:** Voice-controlled computer — talk to your computer and it does what you say.

**Problem:** Voice assistants can't control your computer. Siri, Alexa, and Google only work with apps that built integrations. The web — where people spend most of their time — has no voice interface.

**Solution:** Centris lets you control your entire computer with your voice. Say "go to Gmail and reply to John" and it happens — using your real browser with your logged-in accounts.

**Business Model:**

- Consumer subscriptions ($25-$99/month)
- Enterprise licensing ($149-$499/seat/month)
- API for developers ($0.01-$0.05/task)

**Traction:**

- 200+ waitlist signups (192 in first 3 days)
- Working prototype with native apps (macOS, iOS, Android)
- Chrome extension for browser automation

**Funding:** Seeking $200K-$750K pre-seed for beta launch and PMF validation.

**Projections:**

- Year 1: $3.3M ARR
- Year 2: $42M ARR
- Year 3: $260M ARR

---

## 2. Problem

### The Problem

**Voice assistants don't work on websites.** You can say "Hey Siri, play music" but not "Go to Gmail and reply to John." The web has no voice interface.

People stop what they're doing — cooking, exercising, holding a baby — walk to the computer, and type. They accept that computers require hands.

### Who Has This Problem

**Primary customers:**

1. **Everyday people** — Anyone who uses a computer but wishes they could just talk to it. Students doing research. Parents managing schedules. People who want hands-free control.

2. **Students** — Juggling assignments, research, emails, and deadlines. Voice control lets them work while eating, walking to class, or lying in bed.

3. **Multitaskers** — People cooking dinner, folding laundry, or on the treadmill who want to check email, play music, or look something up without stopping.

4. **Accessibility users** — People with motor impairments, RSI, carpal tunnel, or limited mobility who need hands-free computer control. Current options are limited and expensive ($300+).

### Current Solutions (and why they fail)

| Solution                     | Why It Fails                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Siri/Alexa/Google**        | Only works with apps that built integrations. Can't browse web, fill forms, or control most software. |
| **Dragon NaturallySpeaking** | $300+, clunky, designed for dictation not control. Overkill for normal users.                         |
| **Keyboard shortcuts**       | Requires technical knowledge. Most people don't know they exist.                                      |
| **Doing nothing**            | They stop what they're doing and use the keyboard. Or skip the task entirely.                         |

---

## 3. Solution

### What Centris Does

Centris lets you control your entire computer with your voice — just say what you want and it happens.

**Examples:**

- "Open Gmail and compose an email to John"
- "Search for flights to New York"
- "Play that video on YouTube"
- "Fill out this form with my info"
- "Take a screenshot and send it to Sarah"

### How It Works

1. **User speaks** → Deepgram transcribes voice to text
2. **Orchestrator routes** → Task sent to specialized agent (Browser, System, File)
3. **Agent executes** → Actions performed via browser automation or system tools
4. **Results spoken** → Response synthesized as speech

### Key Differentiators

| Feature       | Centris                                   | Competitors                       |
| ------------- | ----------------------------------------- | --------------------------------- |
| **Browser**   | User's actual Chrome (logged-in accounts) | Cloud sandbox (no account access) |
| **Detection** | DOM/accessibility tree (semantic, stable) | Screenshots (brittle, slow)       |
| **Latency**   | 50-100ms                                  | 500-2000ms                        |
| **Setup**     | Zero (no OAuth, no API keys)              | Requires configuration            |
| **Focus**     | Voice-first (hands-free use cases)        | Text-first                        |

### Technical Architecture

**Multi-Agent System:**

- **Orchestrator:** Routes tasks to specialized agents
- **BrowserAgent:** Web automation via Chrome extension + CDP
- **SystemAgent:** OS-level control (keyboard, mouse, apps)
- **FileAgent:** File operations
- **PlanningAgent:** Creates task plans

**Tech Stack:**

- Backend: Python, Flask, SocketIO
- LLM: Gemini 2.5 Flash-Lite (primary), DeepSeek (planning)
- Native: Swift (iOS/macOS), Kotlin (Android), Electron (desktop)
- Voice: Deepgram
- Browser: Chrome extension (Manifest v3)

**Pattern Caching:** System learns and reuses flows (Gmail, YouTube, etc.) — 30-50% cost reduction on repeated tasks.

---

## 4. Target Market

### Market Size

| Segment | Size           | Notes                                                            |
| ------- | -------------- | ---------------------------------------------------------------- |
| **TAM** | $150B+         | Enterprise IT automation + Productivity software + Accessibility |
| **SAM** | $30B           | Voice-controlled productivity, browser automation, accessibility |
| **SOM** | $500M (Year 5) | 500K paying users + Enterprise + API                             |

### Customer Segments

**Phase 1 (Now): Consumers**

- Students
- Everyday users
- Multitaskers
- Accessibility users

**Phase 2 (Year 1-2): Prosumers & SMBs**

- Remote workers
- Content creators
- Small businesses

**Phase 3 (Year 2-3): Enterprise**

- Teams wanting productivity gains
- Companies with accessibility requirements
- Organizations automating workflows

### Go-to-Market Strategy

**Consumer (PLG motion):**

1. Free tier (150 tasks/month) for trial and virality
2. Organic growth via word-of-mouth, social proof
3. Convert to paid via usage limits and premium features

**Enterprise (Sales-led):**

1. Inbound from consumer adoption (employees → IT)
2. Dedicated sales team (Q3 Year 1)
3. Account-based marketing to target companies

---

## 5. Business Model

### Revenue Streams

#### Stream 1: Consumer Subscriptions

| Tier      | Monthly | Tasks/Month  | Target          |
| --------- | ------- | ------------ | --------------- |
| **Free**  | $0      | ~150 (5/day) | Trial, students |
| **Pro**   | $25     | 100          | Casual users    |
| **Elite** | $49     | 200          | Power users     |
| **Max**   | $99     | 400          | Heavy users     |

Annual pricing = 20% discount

#### Stream 2: Enterprise Licensing

| Tier           | Per Seat/Month | Min Seats | Features                                |
| -------------- | -------------- | --------- | --------------------------------------- |
| **Team**       | $149           | 5         | Admin dashboard, shared workspace       |
| **Business**   | $249           | 25        | SSO, audit logs, priority support       |
| **Enterprise** | $499           | 100       | Custom integrations, SLA, dedicated CSM |

#### Stream 3: API

| Tier          | Monthly | Tasks Included | Overage     |
| ------------- | ------- | -------------- | ----------- |
| **Developer** | $0      | 500            | $0.05/task  |
| **Startup**   | $99     | 5,000          | $0.02/task  |
| **Growth**    | $499    | 50,000         | $0.01/task  |
| **Scale**     | $1,999  | 500,000        | $0.004/task |

### Unit Economics

**Cost per task:** ~$0.0015 (Gemini 2.5 Flash-Lite + Deepgram)

| Tier                    | Revenue/Task | Cost/Task | Gross Margin |
| ----------------------- | ------------ | --------- | ------------ |
| Pro ($25/100 tasks)     | $0.25        | $0.0015   | **99.4%**    |
| API Growth ($0.01/task) | $0.01        | $0.0015   | **85%**      |
| Enterprise              | Higher       | $0.0015   | **99.5%+**   |

**Target gross margin at scale: 90%+**

### Strategic Moat: CLI/SDK (Free, Not Revenue)

The CLI and SDK are **free** — they're a competitive moat, not a revenue stream.

**How it works:**

- Developers use free SDK to build connectors (custom tools the LLM can invoke)
- Companies add a centris.json manifest to their code or run `centris manifest init/record/publish` in their terminal
- Manifests describe app layout (routes, actions, landmarks, selectors) upfront — we know the layout before loading the page
- Companies can host `/.well-known/centris.json` so we fetch and index their layout via CLI/manifest discovery
- TypeScript and Python SDKs with CLI (init, validate, test, serve, publish)
- Community and companies contribute connectors + manifests = free R&D
- More manifests → we know more app layouts in advance → faster execution, fewer LLM turns

**Flywheel effect:** More companies publishing manifests means better voice control on their products; we know their system layout before the user navigates.

---

## 6. Competitive Analysis

### Competitor Landscape

| Competitor                   | Approach           | Weakness                               |
| ---------------------------- | ------------------ | -------------------------------------- |
| **OpenAI Operator**          | Cloud browser      | Can't access user's logged-in accounts |
| **Anthropic Computer Use**   | Screenshot-based   | Slow, brittle when layouts change      |
| **BrowserOS (YC S24)**       | Developer tool     | Requires writing code                  |
| **Dragon NaturallySpeaking** | Dictation software | $300+, not voice control               |
| **Siri/Alexa/Google**        | Voice assistant    | Only works with integrated apps        |

### Why Centris Wins

1. **No OAuth required** — Uses existing browser sessions. Zero friction. Instant access to everything users are already logged into.

2. **DOM > Screenshots** — Semantic element detection is faster and more reliable than vision-based clicking.

3. **50-100ms latency** — Speed creates habit formation. Competitors at 500-2000ms feel sluggish.

4. **Voice-first** — Designed for hands-free use cases. Typing commands is slower than doing it; speaking is genuinely useful.

5. **Connector flywheel** — Community-built connectors add capabilities; more connectors attract more users and developers.

---

## 7. Team

### Current Team

**Alexander Habscheid — Founder/CEO**

- Self-taught developer (didn't know GitHub existed May 2025)
- Built MVP in 3 days, spent $1,000 on API costs
- Built 10+ projects in past year
- Moves with velocity and intent

**Shota Oniani — CTO (Joining)**

- Technical architecture and scaling
- 5-7% equity

### Hiring Plan

| Role        | Timeline     | Purpose                       |
| ----------- | ------------ | ----------------------------- |
| Engineer #1 | Post-funding | Backend/infrastructure        |
| Engineer #2 | Q2 2026      | Native apps/browser extension |
| Sales Lead  | Q3 2026      | Enterprise go-to-market       |

---

## 8. Financial Projections

### Revenue Projections

| Year   | Consumer ARR | Enterprise ARR | API ARR | **Total ARR** |
| ------ | ------------ | -------------- | ------- | ------------- |
| Year 1 | $2.16M       | $1.04M         | $0.12M  | **$3.32M**    |
| Year 2 | $21.6M       | $18M           | $2.4M   | **$42M**      |
| Year 3 | $96M         | $150M          | $14.4M  | **$260.4M**   |

### User Growth

| Year   | Total Users | Paid Users | Conversion |
| ------ | ----------- | ---------- | ---------- |
| Year 1 | 30,000      | 4,500      | 15%        |
| Year 2 | 250,000     | 45,000     | 18%        |
| Year 3 | 1,000,000   | 200,000    | 20%        |

### Key Assumptions

- Free → Paid conversion: 15-20%
- Monthly churn: 5% (Year 1) → 3% (Year 3)
- LLM costs decrease 20-30% annually
- Enterprise ACV grows from $50K to $250K

---

## 9. Funding & Milestones

### Current Round: Pre-Seed ($200K - $750K)

**Use of Funds:**

- Product development through beta
- Initial team expansion (1-2 engineers)
- Infrastructure and hosting
- Runway: 12-18 months

**Milestones:**

- [ ] Public beta launch
- [ ] 1,000 active users
- [ ] First paying customers
- [ ] PMF validation (>40% "very disappointed" score)

### Next Round: Seed ($2M - $5M)

**Timeline:** Q3-Q4 2026

**Milestones:**

- [ ] 10,000 active users
- [ ] $100K MRR
- [ ] First enterprise customers
- [ ] Sales lead + 2 engineers hired

### Future: Series A ($15M - $25M)

**Timeline:** 2027

**Milestones:**

- [ ] $2M+ MRR
- [ ] 50+ enterprise customers
- [ ] International expansion
- [ ] 20+ person team

---

## 10. Traction & Validation

### Current Traction

| Metric            | Status                    |
| ----------------- | ------------------------- |
| Waitlist          | 200+ signups              |
| First 3 days      | 192 signups (organic)     |
| MVP               | Working prototype         |
| Native apps       | macOS, iOS, Android built |
| Browser extension | Chrome extension working  |

### Validation Signals

- **192 signups in 3 days** — organic, no paid ads
- **"I need this"** reactions from multitaskers and accessibility users
- **Speed of development** — MVP built in 3 days demonstrates execution ability

### Next Steps for Validation

1. User interviews (5-10 people) — validate pain points
2. Beta launch — measure activation and retention
3. Sean Ellis test — target >40% "very disappointed" score

---

## 11. Risks & Mitigation

| Risk                      | Probability | Mitigation                                        |
| ------------------------- | ----------- | ------------------------------------------------- |
| **LLM reliability**       | Medium      | Fine-tuning, fallback models, pattern caching     |
| **API cost spikes**       | Low         | Model diversification, batch processing, caching  |
| **Big tech competition**  | High        | Speed to market, enterprise focus, connector moat |
| **Slow enterprise sales** | Medium      | PLG motion, self-serve onboarding first           |
| **User churn**            | Medium      | Usage-based value, habit formation via speed      |

---

## 12. Why Now?

1. **LLM costs dropped 10x** — Gemini 2.5 Flash-Lite makes voice automation economically viable ($0.001/iteration)

2. **Voice recognition mature** — Deepgram and Whisper provide near-human accuracy

3. **Browser automation improved** — CDP and accessibility APIs enable reliable control

4. **Consumer readiness** — Siri/Alexa trained users to expect voice control; frustration that it doesn't work everywhere

5. **Remote work shift** — More people spending more time on computers, wanting efficiency

---

## Appendix: Contact & Links

**Founder:** Alexander Habscheid
**Email:** [FILL]
**Website:** https://centris.ai
**Waitlist:** 200+

---

_Business Plan Version 1.0 | February 2026_
