# Centris AI Business Plan

**Company:** Centris AI  
**Founder:** Alexander Habscheid  
**Date:** February 2026  
**Stage:** Startup  
**Industry:** Software / Web Platform

---

## Executive Summary

Centris AI is a voice-controlled computer platform that lets users control their entire computer with natural speech. Users simply say what they want — "go to Gmail and reply to John" — and it happens, using their real browser with their logged-in accounts. No setup, no configuration, no technical knowledge required.

The platform achieves 75-85% gross margins through strategic technology choices: Gemini 2.5 Flash-Lite as the primary LLM at $0.005-$0.008 per task average (depending on task complexity), multi-layer caching that reduces costs by 40-60%, and a Chrome extension architecture using DOM-based detection rather than expensive screenshot processing. The developer ecosystem through our SDK and CLI creates network effects and serves as a defensible competitive moat.

We are seeking $200K-$750K in pre-seed funding to launch our public beta, validate product-market fit, and expand our initial team. Our projections show Year 1 ARR of $3.3M, growing to $42M ARR in Year 2 and $260M ARR in Year 3, with target gross margins of 90%+ at scale.

---

## 1. Problem Statement

### The Core Problem

Voice assistants today cannot control your computer. Siri, Alexa, and Google Assistant only work with apps that have built specific integrations. The web — where people spend the majority of their digital lives — has no voice interface. You can say "Hey Siri, play music" but not "Go to Gmail and reply to John's email."

This creates a fundamental friction in how people interact with technology. Users constantly stop what they're doing — cooking dinner, exercising, holding a baby, driving — walk to their computer, and type. They have accepted that computers require hands, even though voice would be faster and more natural for many tasks.

### Customer Pain Points

**Emotional Pain Points:**
Users feel frustrated when they have to interrupt an activity to complete a simple computer task. There's a sense of helplessness when hands are occupied but a quick email check or web search is needed. Many users feel overwhelmed trying to juggle physical activities with digital tasks, leading to stress and reduced productivity. Parents describe guilt when they put down their child to answer an email. People with disabilities feel excluded from technology that assumes able-bodied interaction.

**Functional Pain Points:**
Current voice assistants have extremely limited capabilities outside their walled gardens. There's no way to control web applications, fill out forms, or navigate complex websites with voice. Existing accessibility tools like Dragon NaturallySpeaking cost $300+ and are designed for dictation rather than computer control. Users must learn complex keyboard shortcuts or use multiple applications to accomplish tasks that should be simple. Browser automation requires technical knowledge most users don't have.

**Financial Pain Points:**
Productivity loss from context-switching costs knowledge workers an estimated 2-3 hours per day. Accessibility software is prohibitively expensive for many who need it. Businesses pay for tools that partially solve the problem but don't integrate well together. The opportunity cost of tasks not completed because they required too much effort is impossible to measure but significant.

### Customer Discovery Insights

Through interviews with 25+ potential customers, we identified consistent patterns. Multitaskers (parents, cooks, fitness enthusiasts) described specific moments where they wished they could just ask their computer to do something. Students talked about wanting to research and take notes while eating or walking between classes. Accessibility users explained that existing solutions are either too expensive, too complicated, or designed for dictation rather than control. Remote workers expressed frustration that their smart home responds to voice commands but their work computer does not.

---

## 2. Target Market & Sizing

### Market Size Estimates

**TAM (Total Addressable Market): $150B+**

The total addressable market encompasses enterprise IT automation ($80B), productivity software ($50B), and accessibility technology ($20B). This represents all potential revenue if Centris captured 100% of the voice-controlled computer automation market globally.

**SAM (Serviceable Addressable Market): $30B**

Our serviceable market focuses on voice-controlled productivity tools, browser automation platforms, and accessibility software in English-speaking markets. This narrows to users who actively seek hands-free computer control solutions and are willing to pay for premium productivity tools.

**SOM (Serviceable Obtainable Market): $500M by Year 5**

Our realistic obtainable market over five years targets 500,000 paying consumer users, enterprise deployments across 1,000+ companies, and API revenue from developers building on our platform. This assumes aggressive but achievable growth in a market ready for this solution.

### Market Mapping

**Primary Customer Segments:**

The consumer market divides into four key segments. Everyday users represent the largest group — anyone who uses a computer but wishes they could just talk to it. This includes people doing research, managing schedules, or simply wanting hands-free control during daily activities. Students form our second segment, constantly juggling assignments, research, emails, and deadlines while wanting to work during meals, walks between classes, or while relaxing. Multitaskers include people cooking dinner, folding laundry, exercising, or on the treadmill who want to check email, play music, or look something up without stopping. Accessibility users represent our fourth segment — people with motor impairments, RSI, carpal tunnel, or limited mobility who need hands-free computer control but find current options limited and expensive.

**Geographic Focus:**

Our initial focus is the United States market, where we have strong product-market fit signals and where early adopters are most willing to try new productivity tools. English-speaking markets (UK, Canada, Australia) represent natural expansion targets. Long-term, we see significant opportunity in markets with aging populations and increasing accessibility needs.

**Competitive Landscape:**

The market includes several categories of competitors. Consumer voice assistants (Siri, Alexa, Google) dominate voice interaction but cannot control computers or websites beyond pre-built integrations. Accessibility software like Dragon NaturallySpeaking addresses dictation but costs $300+ and isn't designed for computer control. Browser automation tools require technical knowledge and coding ability. Cloud-based computer agents like OpenAI Operator and Anthropic Computer Use use screenshot-based approaches that are slow, expensive, and cannot access users' logged-in accounts.

---

## 3. Solution Hypothesis

### Core Solution

Centris enables voice control of your entire computer through a simple proposition: speak what you want, and it happens. The system uses your real browser with your already logged-in accounts, requiring zero setup or configuration. Say "Open Gmail and compose an email to John" and watch it happen. Say "Search for flights to New York" and the search appears. Say "Fill out this form with my information" and the form populates.

### How It Works

The technical architecture follows a four-step flow. First, the user speaks a command, which Deepgram transcribes to text with near-human accuracy. Second, the orchestrator analyzes the request and routes it to the appropriate specialized agent — browser, system, or file. Third, the agent executes the required actions through browser automation via our Chrome extension or system-level tools for keyboard, mouse, and application control. Finally, results are synthesized as speech and delivered back to the user.

### Technology Differentiation

Our architecture makes fundamentally different choices than competitors, resulting in a 25-100x cost advantage per task.

We use DOM-based detection rather than screenshots. While competitors process images of the screen to figure out what to click, our Chrome extension reads the document object model directly. This is faster (50-100ms vs 500-2000ms latency), more reliable (semantic element identification vs brittle visual matching), and dramatically cheaper (no vision model costs).

We leverage the user's actual browser session. Competitors spin up isolated cloud browsers that cannot access the user's logged-in accounts. Centris works with the user's real Chrome — their Gmail is already logged in, their bank is already authenticated, their workflow is already there. Zero OAuth configuration, instant access to everything.

We deploy caching at multiple layers. Template caching stores system prompts to avoid repeated processing. Semantic caching through Cloudflare AI Gateway recognizes similar requests. Provider-level caching from Gemini reduces costs on repeated patterns. In practice, these layers reduce costs by **40-60%** on cache hits (realistic hit rates vary by usage pattern).

---

## 4. MVP Scope & Flow

### Minimum Viable Product Definition

The MVP focuses on browser automation through voice, targeting the use case that resonated most strongly in customer discovery: hands-free web browsing and simple task completion.

**Core MVP Features:**

- Voice command capture through native apps (macOS, iOS, Android)
- Browser automation via Chrome extension
- Basic web tasks: navigation, clicking, typing, form filling, reading content
- Voice response synthesis for results and confirmations

**MVP User Flow:**

The user downloads the Centris app for their platform. Upon first launch, they grant microphone permission and install the Chrome extension with a single click. There is no account creation required for the free tier.

To use Centris, the user activates voice input through a hotkey, tap, or wake word. They speak their command naturally — "open my Gmail and read the first unread email." They watch as the browser navigates, clicks, and performs the requested action. They hear the spoken result — "You have an email from Sarah about the project meeting tomorrow."

The experience should feel like having a capable assistant controlling the computer on your behalf, responding within seconds to natural language requests.

### MVP Success Criteria

Product-market fit will be validated through the Sean Ellis test, targeting greater than 40% of users responding they would be "very disappointed" if they could no longer use Centris. We target 1,000 active users within 90 days of public beta launch, with a free-to-paid conversion rate exceeding 5%.

---

## 5. Value Proposition

### For Consumers

Centris delivers hands-free computer control that actually works. Unlike Siri or Alexa, it controls any website using your real accounts. Unlike accessibility software, it's affordable and designed for everyone. Unlike learning keyboard shortcuts or automation tools, it requires zero technical knowledge.

The emotional value is freedom — freedom to cook dinner while checking email, to exercise while managing your calendar, to hold your baby while responding to a message. The functional value is speed — voice is faster than typing for many tasks, and there's no context-switching cost. The financial value is time saved — even 15 minutes per day represents significant productivity gains over a year.

### For Developers

The SDK and CLI enable developers and companies to extend Centris in two ways. First, connectors let developers register custom tools that the LLM can invoke alongside browser, computer, and file tools. Second, and distinctively, the manifest system lets companies describe their app's layout upfront — before Centris ever loads the page. Companies add a `centris.json` manifest to their codebase or run `centris manifest init`, `centris manifest record`, and `centris manifest publish` in their terminal. They can host the manifest at `/.well-known/centris.json` so our system fetches it and knows exactly what routes, actions, landmarks, and selectors their app has. We access their system via CLI and manifest discovery; we know the layout before the user navigates. TypeScript and Python SDKs are available with CLI commands for init, validate, test, serve, and publish. This is provided free with no revenue share, creating an open ecosystem that benefits all participants.

Developers and companies gain voice control for their applications without building AI infrastructure. They contribute layout metadata that makes Centris faster and more reliable on their sites.

### For Enterprise

Enterprise customers gain productivity improvements across their workforce. Accessibility compliance becomes easier with a solution that works across all web applications. Workflow automation reduces manual task burden. The platform integrates with existing tools rather than requiring migration.

---

## 6. Cost Structure & Unit Economics

### Per-Task Cost Analysis

Our architecture achieves dramatically lower costs than competitors through three key choices. All figures below use verified API pricing (Gemini 2.5 Flash-Lite, Deepgram Nova-3) and realistic token/usage assumptions.

**LLM Costs:**
Gemini 2.5 Flash-Lite: $0.10 per million input tokens, $0.40 per million output tokens, cached input $0.01 per million (90% discount). A typical browser task requires 2-5 LLM calls depending on complexity. Each call sends ~2,400 tokens (system prompt) plus tool results (snapshots ~1,000 tokens each). Simple tasks (navigate + click): ~6,000 input + 400 output ≈ $0.001. Medium tasks (navigate, click, type, read): ~15,000 input + 800 output ≈ $0.002. Complex multi-step tasks (form filling, retries, multiple pages): ~30,000 input + 1,500 output ≈ $0.004-$0.006. Caching reduces repeated system-prompt costs by ~40-60% in practice. **Realistic weighted average: $0.003-$0.005 per task** (mix of simple/medium/complex, accounting for retries and cache misses).

**Voice Costs:**
Deepgram Nova-3: $0.0077 per minute (pay-as-you-go) or $0.0065 per minute (growth plans). Average voice command ~3 seconds ≈ $0.0004. TTS (ElevenLabs or similar): ~$0.0003-$0.0006 per response (50-100 words). **Total voice per task: ~$0.0007-$0.001.**

**Combined Cost Per Task:**

- Simple tasks (single navigation, one action): **$0.002-$0.003** (LLM + voice)
- Medium tasks (2-3 tool iterations): **$0.004-$0.006**
- Complex tasks (multi-page, form filling, retries): **$0.007-$0.012**
- **Weighted average across all task types: $0.005-$0.007 per task** (includes infrastructure overhead, retries, and cache-miss scenarios)

**Cost Variance: Long-Running Tasks**

A single task can require 30-100 LLM calls when the user asks for something that demands exploration, multi-page workflows, form filling across many fields, or retries due to dynamic content. At ~$0.0004 per call, those tasks cost **$0.013-$0.04** (LLM + voice). Centris must fully complete any user task — no step caps or artificial cutoffs — because that is the core value proposition. Users get real outcomes, not partial results.

Consumer per-task pricing absorbs this variance: one user request counts as one task regardless of how many steps it takes. A 100-call task still costs the user one task from their quota; we incur ~$0.04 but receive $0.25 (Pro) or $0.2475 (Max), so margins remain positive (84-98%). The blended average across many users holds.

The API tier is the risk area: at $0.01/task, a 30-call task (~$0.013 cost) or 100-call task (~$0.04 cost) is margin-negative. Mitigations include step-based overage pricing for tasks exceeding a threshold, higher base pricing for high-volume API customers, or efficiency improvements (better prompting, tool batching, retry logic) that reduce the number of calls needed to complete the same outcome — which benefits users and economics alike.

### Pricing Structure

Consumer subscription tiers are designed for different usage levels. The Free tier provides 5 tasks per day (~150 monthly) at no cost, serving as a trial and student option. Pro tier costs $25 per month for 100 tasks monthly, targeting casual users. Elite tier costs $49 per month for 200 tasks monthly, serving power users. Max tier costs $99 per month for 400 tasks monthly, for heavy users. Annual pricing offers a 20% discount.

Enterprise tiers scale from Team at $149 per seat per month (minimum 5 seats) to Business at $249 (minimum 25 seats) and Enterprise at $499 (minimum 100 seats), adding features like admin dashboards, SSO, audit logs, custom integrations, dedicated CSM, and SLA guarantees. Custom pricing is available for 500+ seats with on-prem and white-label options.

API pricing for developers starts with a free Developer tier of 500 tasks monthly, scaling through Startup ($99/month for 5,000 tasks, $0.02 overage), Growth ($499/month for 50,000 tasks, $0.01 overage), and Scale ($1,999/month for 500,000 tasks, $0.004 overage) tiers.

### Margin Analysis

At current pricing and **realistic** per-task costs of ~$0.006 (weighted average):

- **Pro** ($25/100 tasks): $0.25 revenue per task, $0.006 cost — **97.6%** gross margin
- **Elite** ($49/200 tasks): $0.245 revenue per task, $0.006 cost — **97.6%** gross margin
- **Max** ($99/400 tasks): $0.2475 revenue per task, $0.006 cost — **97.6%** gross margin
- **API Growth** ($0.01/task): $0.01 revenue per task, $0.006 cost — **40%** gross margin (API tier is margin-thin; volume and higher tiers improve economics)
- **Enterprise** ($499/seat): higher revenue per task, $0.006 cost — **98%+** gross margin

Target gross margin at scale: **85-90%** (after infrastructure, support, payment processing, Stripe fees, and realistic cost variance).

---

## 7. Competitive Advantage

### Cost Advantage

Centris is 25-100x cheaper per task than alternatives due to architectural choices.

Competitors using screenshot-based approaches (Anthropic Computer Use, OpenAI Operator, various open-source tools) require vision model calls for every action, encode images into tokens at 4x the cost, and cannot leverage user sessions for authentication. Their estimated costs range from $0.05 to $0.30 per task. Centris achieves **$0.005-$0.007 per task** (realistic weighted average) through DOM-based detection, cheaper models, and caching — still 7-60x cheaper than alternatives.

This cost advantage translates directly to margin advantage, enabling competitive pricing while maintaining profitability that screenshot-based competitors cannot match.

### Technical Advantage

DOM-based detection is fundamentally superior to screenshot-based approaches for computer control. It's faster because there's no image processing — actions execute in 50-100ms versus 500-2000ms for vision-based systems. It's more reliable because element identification is semantic rather than visual, so it works regardless of themes, zoom levels, or visual variations. It's more capable because it can read page content, understand form structures, and interact with elements that may not be visually distinct.

### Ecosystem Moat

The developer ecosystem creates compounding advantages over time. More connectors mean more capabilities. More companies publishing manifests (centris.json) mean we know more app layouts before users navigate — faster execution, fewer exploratory LLM turns. Improved execution attracts more developers and companies to contribute. This flywheel creates network effects and switching costs that are difficult for competitors to replicate.

The SDK and CLI are intentionally free with no revenue share. Lower barriers drive faster ecosystem growth. Companies that add manifests get better voice control on their own products. The value accrues to the platform through improved capabilities and user retention, not through taxing the developer ecosystem.

---

## 8. Traction & Validation

### Current Traction

The product has generated significant early interest with minimal marketing effort. We achieved 200+ waitlist signups, with 192 coming in the first three days through purely organic discovery. The working prototype demonstrates full functionality with native apps built for macOS, iOS, and Android, plus a Chrome extension for browser automation.

### Validation Signals

Customer discovery interviews consistently revealed strong demand. Users described specific moments of frustration that Centris would solve. The "I need this" reaction was particularly strong from multitaskers (parents, cooks, fitness enthusiasts) and accessibility users. The speed of development — MVP built in three days — demonstrates execution capability that resonates with investors.

### Next Validation Steps

Immediate priorities include conducting 5-10 additional structured user interviews to validate pain points and willingness to pay. Public beta launch will measure activation, retention, and conversion rates. The Sean Ellis test will validate product-market fit with a target of greater than 40% "very disappointed" responses. These metrics will inform pricing optimization and feature prioritization.

---

## 9. Business Model & Revenue Projections

### Revenue Streams

The business generates revenue from three sources. Consumer subscriptions represent the primary revenue stream, with tiers from $25 to $99 per month targeting different usage levels. Enterprise licensing adds higher-value contracts at $149-$499 per seat per month with multi-year commitments. API revenue from developers provides a third stream, with usage-based pricing from free tier through $1,999 per month for high-volume users.

### Financial Projections

**Year 1 (2026 - Launch & Validation):**
We project reaching 30,000 total users by year-end with 15% conversion to paid (4,500 paid users). Combined with 15 enterprise customers (350 seats) and early API adoption:

- Consumer ARR: $2.16M
- Enterprise ARR: $1.04M
- API ARR: $0.12M
- **Total Year 1 ARR: $3.32M**

**Year 2 (2027 - Growth & Scale):**
Scaling to 250,000 total users with 18% conversion (45,000 paid users), plus 120 enterprise customers (6,000 seats):

- Consumer ARR: $21.6M
- Enterprise ARR: $18M
- API ARR: $2.4M
- **Total Year 2 ARR: $42M**

**Year 3 (2028 - Market Leadership):**
Reaching 1,000,000 total users with 20% conversion (200,000 paid users), plus 500 enterprise customers (50,000 seats):

- Consumer ARR: $96M
- Enterprise ARR: $150M
- API ARR: $14.4M
- **Total Year 3 ARR: $260.4M**

### Break-Even Analysis

The business reaches break-even quickly due to favorable unit economics (97%+ gross margin on consumer tiers). At 50 paying users, we cover API costs operating as a solo developer. At 500 users, we can support a small team of three. At 4,500 paid users (Year 1 target), we achieve $3.32M ARR with sustainable economics. At scale, target gross margin is **85-90%** after accounting for infrastructure, support, payment processing, and realistic cost variance.

---

## 10. Risk Analysis

### Technology Risks

Chrome extension policy changes represent the highest-impact technology risk. Mitigation includes maintaining a native app fallback path that could provide similar functionality through system-level automation. DOM structure changes on major websites present ongoing challenges, but the LLM naturally adapts to layout changes, and pattern caching helps maintain reliability. Provider rate limits or outages could impact service, which we mitigate through multi-provider fallback chains.

### Market Risks

Competition from major technology companies (Google, Apple, Microsoft) remains an ongoing concern. However, their focus on ecosystem-locked voice assistants suggests limited appetite for open computer control. We differentiate on capability (any website, any application) rather than competing on brand or distribution. The open-source community could develop alternatives, but our ecosystem and execution speed provide meaningful advantages.

### Financial Risks

LLM cost increases could compress margins, though current trends show declining prices. We maintain fallback options (DeepSeek, open-source models) that could substitute if Gemini pricing becomes unfavorable. Long-running tasks (30-100 LLM calls) can cost $0.013-$0.04 each; we do not cap task completion (users must get full value), but consumer per-task pricing absorbs this variance while API tier may require step-based overage or pricing adjustments. User behavior exceeding projections could increase costs; rate limits and usage-based pricing provide natural controls. Slow enterprise sales could impact revenue projections; the PLG motion through consumer adoption provides a hedge.

---

## 11. Team & Hiring Plan

### Current Team

Alexander Habscheid serves as Founder and CEO. A self-taught developer who began serious coding in May 2025, Alexander built the Centris MVP in three days and has shipped 10+ projects in the past year. This execution velocity demonstrates the rapid iteration capability essential for an early-stage startup.

Shota Oniani is joining as CTO, bringing technical architecture and scaling expertise. Equity allocation of 5-7% reflects the significance of this role.

### Hiring Plan

Post-funding priorities include hiring Engineer #1 for backend and infrastructure development, followed by Engineer #2 in Q2 2026 focusing on native apps and browser extension refinement. A Sales Lead hire in Q3 2026 will support enterprise go-to-market efforts. Team scaling continues with engineering and support hires as revenue supports expansion.

---

## 12. Funding & Use of Funds

### Current Round: Pre-Seed ($200K - $750K)

We are seeking $200K-$750K in pre-seed funding to take Centris from working prototype to product-market fit.

**Use of Funds:**

Product development through beta launch and initial iteration consumes approximately 40% of funds. This includes infrastructure, API costs during beta, and development tools. Initial team expansion to 1-2 additional engineers takes approximately 35% of funds. Operations and runway reserve account for the remaining 25%, providing 12-18 months of runway.

**Milestones for This Round:**

- Public beta launch
- 1,000 active users
- First paying customers
- PMF validation (>40% Sean Ellis score)

### Future Rounds

Seed round ($2M-$5M) targeted for Q3-Q4 2026 will fund scaling to 10,000 users, $100K MRR, first enterprise customers, and team expansion to 5-6 people.

Series A ($15M-$25M) targeted for 2027 will fund scaling to $2M+ MRR, 50+ enterprise customers, international expansion, and team growth to 20+ people.

---

## 13. Why Now?

Several converging factors make this the optimal time for Centris.

**LLM costs have dropped 10x.** Gemini 2.5 Flash-Lite makes voice automation economically viable at approximately $0.003-$0.005 per task (realistic average). This was impossible even two years ago.

**Voice recognition has reached maturity.** Deepgram and Whisper provide near-human accuracy in speech recognition, eliminating what was previously a major friction point.

**Browser automation technology has improved.** Chrome DevTools Protocol and accessibility APIs enable reliable programmatic control of web browsers.

**Consumer expectations have been set.** Siri, Alexa, and Google Assistant trained users to expect voice control. The frustration that it doesn't work for computers creates pull for a solution.

**Remote work has expanded the market.** More people spend more time on computers and seek efficiency improvements. The pandemic accelerated this shift permanently.

---

## Appendix: Product Mockups & User Flow

### User Interface Concept

The Centris interface prioritizes simplicity and minimal visual footprint. The macOS menubar app provides quick access without consuming screen space. The mobile apps (iOS/Android) enable voice control from anywhere. The Chrome extension operates invisibly, activating only when commands are issued.

### Primary User Flow

```
User speaks: "Open Gmail and read my first email"
    ↓
Voice captured → Transcribed by Deepgram → Processed by Orchestrator
    ↓
Browser Agent receives task → Plans steps → Executes via Chrome extension
    ↓
Navigate to gmail.com → Click first email → Extract content
    ↓
Response synthesized → Spoken to user: "Your first email is from Sarah..."
```

### Key Screens

Detailed wireframes and mockups are available upon request. The core interfaces include:

- Native app voice input screen (minimal, focused on the microphone)
- Chrome extension popup (status and connection info)
- Settings interface (model selection, voice preferences, usage stats)
- Dashboard (usage history, saved patterns, billing)

---

## Contact Information

**Founder:** Alexander Habscheid  
**Email:** habscheid@msu.edu  
**Website:** https://centris.ai  
**GitHub:** Private repository (available for investor technical review)

---

_Business Plan Version 2.0 | February 2026_  
_Prepared for Venture Planner | Michigan State University Entrepreneurship Program_
