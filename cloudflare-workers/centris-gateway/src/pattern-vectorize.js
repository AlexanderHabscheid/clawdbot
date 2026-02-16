/**
 * Pattern Vectorize Integration for Centris AI
 * ============================================
 *
 * This module handles semantic search over complex task patterns
 * using Cloudflare Vectorize. When a user's intent is received,
 * we search for the most similar pattern and return the execution flow.
 *
 * GENERALIZATION:
 * Both intents and user queries are generalized before embedding:
 *   "Forward email to john@gmail.com" → "forward email to {email}"
 *   "Buy 3 items from Amazon" → "buy {quantity} items from {retailer}"
 *
 * This enables semantic matching across variants:
 *   "Forward report to alice@company.com" → matches "forward email to {email}"
 *
 * Setup:
 *   1. Create Vectorize index: wrangler vectorize create centris-patterns --dimensions=768 --metric=cosine
 *   2. Bind in wrangler.toml: [[vectorize]] binding = "PATTERNS" index_name = "centris-patterns"
 *   3. Deploy and call POST /api/patterns/populate to index all patterns
 */

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN GENERALIZATION
// Converts specific values to placeholders for broader semantic matching
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generalize a pattern by replacing specific values with placeholders.
 * This enables broader pattern matching across variants:
 *
 *   "forward email to john" → "forward email to {name}"
 *   "send report to alice@company.com" → "send {document} to {email}"
 *   "buy 3 items from Amazon for $50" → "buy {quantity} items from {retailer} for {amount}"
 *   "book flight to New York on 1/15" → "book flight to {destination} on {date}"
 *
 * @param {string} text - Raw pattern text
 * @returns {{generalized: string, extractions: object}} - Generalized pattern + extracted values
 */
export function generalizePattern(text) {
  let generalized = text.toLowerCase().trim();
  const extractions = {};

  // Domain/retailer keywords that should become {retailer} or {website}
  const retailers = [
    "amazon",
    "walmart",
    "target",
    "bestbuy",
    "best buy",
    "ebay",
    "etsy",
    "costco",
    "newegg",
  ];
  const websites = new Set([
    "gmail",
    "google",
    "youtube",
    "facebook",
    "twitter",
    "linkedin",
    "outlook",
    "slack",
    "discord",
    "github",
    "expedia",
    "booking",
    "kayak",
    "chase",
    "bankofamerica",
    "wellsfargo",
  ]);
  const socialPlatforms = ["twitter", "facebook", "linkedin", "instagram", "tiktok", "threads"];

  // 1. Replace email addresses with {email}
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = generalized.match(emailRegex);
  if (emails) {
    extractions.emails = emails;
    generalized = generalized.replace(emailRegex, "{email}");
  }

  // 2. Replace full URLs with {url}
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const urls = generalized.match(urlRegex);
  if (urls) {
    extractions.urls = urls;
    generalized = generalized.replace(urlRegex, "{url}");
  }

  // 3. Replace dollar amounts with {amount}
  const moneyRegex = /\$[\d,]+(?:\.\d{2})?/g;
  const amounts = generalized.match(moneyRegex);
  if (amounts) {
    extractions.amounts = amounts;
    generalized = generalized.replace(moneyRegex, "{amount}");
  }

  // 4. Replace number + items patterns with {quantity}
  const quantityRegex = /\b(\d+)\s+(items?|products?|things?|packages?|files?|documents?)\b/gi;
  const quantities = [...generalized.matchAll(quantityRegex)];
  if (quantities.length > 0) {
    extractions.quantities = quantities.map((m) => m[1]);
    generalized = generalized.replace(quantityRegex, "{quantity} $2");
  }

  // 5. Replace dates with {date}
  const dateRegex = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
  const dates = generalized.match(dateRegex);
  if (dates) {
    extractions.dates = dates;
    generalized = generalized.replace(dateRegex, "{date}");
  }

  // Also match natural date references
  const naturalDateRegex =
    /\b(next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|week|month)\b/gi;
  generalized = generalized.replace(naturalDateRegex, "{date}");

  // 6. Replace time references with {time}
  const timeRegex = /\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi;
  const times = generalized.match(timeRegex);
  if (times) {
    extractions.times = times;
    generalized = generalized.replace(timeRegex, "{time}");
  }

  // 7. Replace city/location names after "to/from/in/near" with {destination}/{location}
  // Skip retailers - they get {retailer} instead
  const destinationRegex = /\b(to|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi;
  generalized = generalized.replace(destinationRegex, (match, prep, place) => {
    // Don't replace retailers (amazon, walmart, etc)
    if (retailers.includes(place.toLowerCase())) return match;
    // Don't replace common words
    const commonWords = ["the", "my", "your", "this", "that", "first", "last", "all"];
    if (commonWords.includes(place.toLowerCase())) return match;
    extractions.destinations = extractions.destinations || [];
    extractions.destinations.push(place);
    return `${prep} {destination}`;
  });

  const locationRegex = /\b(in|near|around)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi;
  generalized = generalized.replace(locationRegex, (match, prep, place) => {
    // Don't replace retailers
    if (retailers.includes(place.toLowerCase())) return match;
    const commonWords = ["the", "my", "your", "this", "that", "first", "last", "all"];
    if (commonWords.includes(place.toLowerCase())) return match;
    extractions.locations = extractions.locations || [];
    extractions.locations.push(place);
    return `${prep} {location}`;
  });

  // 8. Extract product/item names (before retailer replacement)
  // Handles: "buy iPhone and AirPods from Amazon" → items: ["iPhone", "AirPods"]
  // Handles: "order a laptop, mouse, and keyboard from Best Buy" → items: ["laptop", "mouse", "keyboard"]
  const buyVerbs = ["buy", "order", "purchase", "get", "shop for", "add"];
  for (const verb of buyVerbs) {
    // Match "buy X from Y" - capture both items and retailer/location
    const itemPattern = new RegExp(`\\b${verb}\\s+(.+?)\\s+(from|on|at)\\s+(\\S+)`, "gi");
    const matches = [...generalized.matchAll(itemPattern)];

    for (const match of matches) {
      const itemsText = match[1];
      const preposition = match[2];
      const retailerName = match[3];

      // Skip if it's just a quantity like "5 items"
      if (/^\d+\s+(items?|products?|things?)$/i.test(itemsText)) continue;

      // Split by comma and "and" to get individual items
      const items = itemsText
        .split(/,\s*(?:and\s+)?|\s+and\s+/i) // Handle ", and" as well as just "and"
        .map((item) => item.replace(/^and\s+/i, "").trim()) // Remove leading "and"
        .filter((item) => item && !/^(a|an|the|some|\d+)$/i.test(item));

      if (items.length > 0) {
        extractions.items = extractions.items || [];
        extractions.items.push(...items);
        // Replace items with {items}, keep retailer for later processing
        generalized = generalized.replace(
          match[0],
          `${verb} {items} ${preposition} ${retailerName}`,
        );
      }
    }
  }

  // 9. Replace retailer names with {retailer} BEFORE destination extraction
  for (const retailer of retailers) {
    const retailerRegex = new RegExp(`\\b${retailer}\\b`, "gi");
    if (retailerRegex.test(generalized)) {
      extractions.retailers = extractions.retailers || [];
      extractions.retailers.push(retailer);
      generalized = generalized.replace(retailerRegex, "{retailer}");
    }
  }

  // 10. Replace social platform names with {platform}
  for (const platform of socialPlatforms) {
    const platformRegex = new RegExp(`\\b${platform}\\b`, "gi");
    if (platformRegex.test(generalized)) {
      extractions.platforms = extractions.platforms || [];
      extractions.platforms.push(platform);
      generalized = generalized.replace(platformRegex, "{platform}");
    }
  }

  // 11. Replace names after "to ", "from ", "for ", "with " (for recipients)
  // Skip if already replaced with {retailer}, {platform}, etc.
  const namePattern = /\b(to|from|for|with|email|message|send)\s+([a-z]+)\b/gi;
  generalized = generalized.replace(namePattern, (match, preposition, name) => {
    // Don't replace domain keywords, retailers, or common words
    if (websites.has(name.toLowerCase())) {
      return match;
    }
    if (retailers.includes(name.toLowerCase())) {
      return match;
    }
    const commonWords = [
      "the",
      "a",
      "an",
      "my",
      "your",
      "this",
      "that",
      "first",
      "last",
      "new",
      "all",
      "me",
      "you",
      "them",
    ];
    if (commonWords.includes(name.toLowerCase())) {
      return match;
    }
    // Don't replace placeholders we've already added
    if (name.startsWith("{")) {
      return match;
    }
    extractions.names = extractions.names || [];
    extractions.names.push(name);
    return `${preposition} {recipient}`;
  });

  // 12. Replace star ratings with {rating}
  const ratingRegex = /\b(\d+)-?star\b/gi;
  generalized = generalized.replace(ratingRegex, "{rating}-star");

  // 13. Replace specific document types with {document}
  const docPattern =
    /\b(quarterly|annual|monthly|weekly|daily|sales|marketing|financial|budget)?\s*(report|spreadsheet|presentation|document|file|pdf|invoice|receipt|resume|cv)\b/gi;
  generalized = generalized.replace(docPattern, (match, modifier, docType) => {
    extractions.documents = extractions.documents || [];
    extractions.documents.push(match.trim());
    return "{document}";
  });

  return { generalized, extractions };
}

// Pattern intent embeddings will be stored here
// In production, these come from the Vectorize index

/**
 * All 30 complex task patterns with their intents for embedding
 *
 * Each pattern includes:
 * - intent: Natural language description (will be generalized)
 * - example_queries: Sample user queries (will be generalized for embedding)
 * - keywords: Important terms for fallback matching
 *
 * GENERALIZATION:
 * Both intents and example_queries are generalized before embedding:
 *   "Forward quarterly report to john@company.com" → "forward {document} to {email}"
 * This enables broader semantic matching across variants.
 */
export const TASK_PATTERNS = [
  {
    id: "email-forward-with-attachments",
    intent:
      "Forward an email with specific attachments to multiple recipients with a custom message",
    example_queries: [
      "forward {document} to {recipient}",
      "send {document} email to {recipient} with attachments",
      "forward that email to {recipient}",
    ],
    category: "email",
    keywords: ["forward", "email", "attachments", "recipients", "send"],
  },
  {
    id: "schedule-meeting-check-availability",
    intent: "Schedule a meeting by checking attendee availability and finding a suitable time slot",
    example_queries: [
      "schedule meeting with {recipient} on {date}",
      "find time to meet with {recipient}",
      "book meeting for {date}",
    ],
    category: "productivity",
    keywords: ["schedule", "meeting", "calendar", "availability", "attendees"],
  },
  {
    id: "compare-products-multiple-sites",
    intent: "Research and compare a product across multiple e-commerce sites to find the best deal",
    example_queries: [
      "compare prices for {product} on {retailer}",
      "find best deal for {product}",
      "shop for {product} across sites",
    ],
    category: "research",
    keywords: ["compare", "prices", "products", "shopping", "amazon", "best buy"],
  },
  {
    id: "extract-web-data-to-spreadsheet",
    intent: "Extract structured data from a webpage and organize it into a spreadsheet",
    example_queries: [
      "extract data from {url} to spreadsheet",
      "scrape {url} into google sheets",
      "copy table data to spreadsheet",
    ],
    category: "productivity",
    keywords: ["extract", "data", "spreadsheet", "scrape", "table", "google sheets"],
  },
  {
    id: "fill-multi-page-application-form",
    intent: "Complete a multi-page application form using information from various sources",
    example_queries: [
      "fill out application for {recipient}",
      "complete job application form",
      "submit application to {recipient}",
    ],
    category: "forms",
    keywords: ["fill", "form", "application", "job", "submit", "resume"],
  },
  {
    id: "research-topic-summarize-report",
    intent: "Research a topic from multiple sources and create a summary report",
    example_queries: [
      "research {topic} and write summary",
      "find information about {topic}",
      "create report on {topic}",
    ],
    category: "research",
    keywords: ["research", "summarize", "report", "sources", "write"],
  },
  {
    id: "download-organize-files-from-web",
    intent: "Download multiple files from a webpage and organize them into folders",
    example_queries: [
      "download files from {url}",
      "save {quantity} files from {url}",
      "organize downloads into folders",
    ],
    category: "file_management",
    keywords: ["download", "files", "organize", "folders", "save"],
  },
  {
    id: "ecommerce-cart-checkout-multi-item",
    intent: "Add multiple items to a shopping cart and complete checkout with shipping and payment",
    example_queries: [
      "buy {quantity} items from {retailer}",
      "checkout cart on {retailer}",
      "order {product} from {retailer} for {amount}",
    ],
    category: "ecommerce",
    keywords: ["buy", "cart", "checkout", "order", "purchase", "shop"],
  },
  {
    id: "pay-bills-online-banking",
    intent: "Pay bills through online banking with verification and confirmation",
    example_queries: [
      "pay {amount} to {recipient}",
      "transfer {amount} for {recipient}",
      "pay bill for {amount}",
    ],
    category: "finance",
    keywords: ["pay", "bills", "bank", "transfer", "payment"],
  },
  {
    id: "track-packages-multiple-carriers",
    intent: "Track packages across multiple carriers and provide unified status update",
    example_queries: [
      "track package from {retailer}",
      "where is my order from {retailer}",
      "check delivery status",
    ],
    category: "ecommerce",
    keywords: ["track", "package", "delivery", "shipping", "ups", "fedex"],
  },
  {
    id: "social-media-post-multiple-platforms",
    intent:
      "Create and post content to multiple social media platforms with customization per platform",
    example_queries: ["post to {platform}", "share on {platform}", "post {content} to {platform}"],
    category: "media",
    keywords: ["post", "social media", "twitter", "linkedin", "facebook", "share"],
  },
  {
    id: "download-convert-video-content",
    intent: "Download video content and convert to different format or extract audio",
    example_queries: ["download video from {url}", "convert video to mp3", "save youtube video"],
    category: "media",
    keywords: ["download", "video", "youtube", "mp3", "convert", "audio"],
  },
  {
    id: "batch-edit-images-web-tool",
    intent: "Edit multiple images using web-based tools (resize, crop, format conversion)",
    example_queries: ["resize {quantity} images", "batch edit images", "crop and resize photos"],
    category: "media",
    keywords: ["edit", "images", "resize", "crop", "batch", "photos"],
  },
  {
    id: "github-review-pull-request",
    intent:
      "Review a GitHub pull request by examining changes, running checks, and providing feedback",
    example_queries: ["review pr on github", "check pull request", "review code changes on github"],
    category: "development",
    keywords: ["review", "pull request", "github", "code", "pr", "merge"],
  },
  {
    id: "debug-api-endpoint-test",
    intent: "Test an API endpoint, debug issues, and document the results",
    example_queries: ["test api at {url}", "debug endpoint {url}", "check api response"],
    category: "development",
    keywords: ["api", "test", "debug", "endpoint", "request", "response"],
  },
  {
    id: "setup-development-environment",
    intent:
      "Set up a development environment for a project by installing dependencies and configuring tools",
    example_queries: [
      "setup dev environment for {project}",
      "install project dependencies",
      "clone and setup {project}",
    ],
    category: "development",
    keywords: ["setup", "development", "install", "dependencies", "clone", "project"],
  },
  {
    id: "draft-email-from-template-context",
    intent: "Compose a professional email using context from previous conversations or templates",
    example_queries: [
      "write email to {recipient}",
      "draft message for {recipient}",
      "compose professional email",
    ],
    category: "email",
    keywords: ["compose", "email", "draft", "write", "professional", "template"],
  },
  {
    id: "book-travel-flight-hotel",
    intent: "Search and book travel arrangements including flights and hotels",
    example_queries: [
      "book flight to {destination}",
      "find hotel in {location}",
      "search flights to {destination} on {date}",
    ],
    category: "travel",
    keywords: ["book", "flight", "hotel", "travel", "trip", "reservation"],
  },
  {
    id: "collaborative-document-editing",
    intent: "Make edits to a shared document based on feedback or instructions",
    example_queries: [
      "edit {document} in google docs",
      "update shared {document}",
      "make changes to {document}",
    ],
    category: "productivity",
    keywords: ["edit", "document", "google docs", "update", "collaborative"],
  },
  {
    id: "backup-sync-cloud-storage",
    intent: "Backup local files to cloud storage or sync between cloud services",
    example_queries: [
      "backup files to cloud",
      "sync to google drive",
      "upload {document} to dropbox",
    ],
    category: "file_management",
    keywords: ["backup", "sync", "cloud", "drive", "dropbox", "upload"],
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // HIGH SCHOOL STUDENT PATTERNS (21-25)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "homework-research-essay",
    intent: "Research a topic and write an essay or homework assignment",
    example_queries: [
      "research {topic} for essay",
      "write paper about {topic}",
      "help with {topic} homework",
    ],
    category: "learning",
    keywords: ["homework", "essay", "research", "write", "paper", "school", "assignment"],
  },
  {
    id: "online-class-join-submit",
    intent: "Join an online class and submit assignments",
    example_queries: [
      "join class on google classroom",
      "submit assignment to canvas",
      "turn in homework",
    ],
    category: "learning",
    keywords: [
      "class",
      "classroom",
      "submit",
      "homework",
      "assignment",
      "canvas",
      "google classroom",
    ],
  },
  {
    id: "study-flashcards-quiz",
    intent: "Create flashcards or take practice quizzes for studying",
    example_queries: [
      "make flashcards for {topic}",
      "practice quiz on {topic}",
      "study for {topic} test",
    ],
    category: "learning",
    keywords: ["flashcards", "study", "quiz", "quizlet", "test", "exam", "practice"],
  },
  {
    id: "math-homework-calculator",
    intent: "Solve math problems and show step-by-step work",
    example_queries: [
      "solve math problem",
      "show steps for equation",
      "help with algebra homework",
    ],
    category: "learning",
    keywords: ["math", "solve", "equation", "calculator", "algebra", "homework", "steps"],
  },
  {
    id: "college-application-track",
    intent: "Research colleges and track application deadlines",
    example_queries: [
      "research {college} requirements",
      "track college application deadlines",
      "find colleges for {major}",
    ],
    category: "learning",
    keywords: ["college", "application", "deadline", "university", "admissions", "apply"],
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // UNIVERSITY STUDENT PATTERNS (26-30)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "lecture-notes-organize",
    intent: "Take, organize, and review lecture notes with study materials",
    example_queries: [
      "organize lecture notes for {topic}",
      "review notes from class",
      "transcribe lecture",
    ],
    category: "learning",
    keywords: ["lecture", "notes", "organize", "study", "class", "review", "transcript"],
  },
  {
    id: "academic-paper-research",
    intent: "Find academic papers and manage citations for research",
    example_queries: [
      "find papers on {topic}",
      "search google scholar for {topic}",
      "manage citations for {document}",
    ],
    category: "learning",
    keywords: ["academic", "paper", "research", "citation", "scholar", "thesis", "journal"],
  },
  {
    id: "schedule-study-sessions",
    intent: "Plan and schedule study sessions with calendar integration",
    example_queries: [
      "schedule study time for {topic}",
      "plan study sessions for finals",
      "add study blocks to calendar",
    ],
    category: "productivity",
    keywords: ["schedule", "study", "calendar", "plan", "exam", "finals", "pomodoro"],
  },
  {
    id: "group-project-collaborate",
    intent: "Coordinate group project work and shared documents",
    example_queries: [
      "setup group project",
      "share {document} with team",
      "collaborate on {document}",
    ],
    category: "productivity",
    keywords: ["group", "project", "collaborate", "team", "share", "drive", "trello"],
  },
  {
    id: "internship-job-apply",
    intent: "Search for internships or jobs and submit applications",
    example_queries: [
      "find internships for {major}",
      "apply to job at {company}",
      "search jobs on linkedin",
    ],
    category: "productivity",
    keywords: ["internship", "job", "apply", "resume", "linkedin", "career", "application"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DESKTOP ACTION PATTERNS (31-50)
  // For ComputerAgent - native macOS/Windows app control via Accessibility APIs
  //
  // IMPORTANT: These are GENERALIZED SCAFFOLDS, not rigid templates!
  // The LLM uses these patterns as guidance to understand:
  //   1. What TYPE of action this is (send_message, open_app, etc.)
  //   2. What PARAMETERS to extract (app, contact, message, etc.)
  //   3. What EXECUTION STEPS to follow
  //
  // The LLM adapts these scaffolds to the user's specific phrasing.
  // ═══════════════════════════════════════════════════════════════════════════

  // --- MESSAGING PATTERNS (with execution scaffolds) ---
  {
    id: "desktop-message-whatsapp",
    intent: "Send a message to someone on WhatsApp desktop app",
    example_queries: [
      "open whatsapp and send a message to {recipient} {message}",
      "message {recipient} on whatsapp {message}",
      "whatsapp {recipient} {message}",
      "tell {recipient} on whatsapp {message}",
      "text {recipient} on whatsapp saying {message}",
    ],
    category: "desktop_action",
    action: "send_message",
    app_hint: "WhatsApp",
    // EXECUTION SCAFFOLD - guides LLM on HOW to execute
    execution_steps: [
      "1. Open WhatsApp application",
      "2. Wait for app to load",
      "3. Find contact by name in search/chat list",
      "4. Click on contact to open chat",
      "5. Find message input field",
      "6. Type the message",
      "7. Press Enter or click Send button",
    ],
    parameters: ["app_name", "contact", "message"],
    keywords: ["whatsapp", "message", "send", "text", "tell", "chat"],
  },
  {
    id: "desktop-message-imessage",
    intent: "Send a message to someone using iMessage/Messages app",
    example_queries: [
      "open messages and text {recipient} {message}",
      "imessage {recipient} {message}",
      "text {recipient} {message}",
      "send a text to {recipient} saying {message}",
      "message {recipient} on imessage {message}",
    ],
    category: "desktop_action",
    action: "send_message",
    app_hint: "Messages",
    execution_steps: [
      "1. Open Messages application",
      "2. Use Cmd+N for new message or search existing",
      "3. Enter contact name in To: field",
      "4. Click in message field",
      "5. Type the message",
      "6. Press Enter to send",
    ],
    parameters: ["app_name", "contact", "message"],
    keywords: ["imessage", "messages", "text", "sms", "send", "apple"],
  },
  {
    id: "desktop-message-slack",
    intent: "Send a message on Slack desktop app",
    example_queries: [
      "message {recipient} on slack {message}",
      "slack {recipient} {message}",
      "tell {recipient} on slack {message}",
      "send slack dm to {recipient} {message}",
      "dm {recipient} on slack {message}",
    ],
    category: "desktop_action",
    action: "send_message",
    app_hint: "Slack",
    execution_steps: [
      "1. Open Slack application",
      "2. Use Cmd+K to open quick switcher",
      "3. Type contact name to find DM",
      "4. Press Enter to open conversation",
      "5. Type message in input field",
      "6. Press Enter to send",
    ],
    parameters: ["app_name", "contact", "message"],
    keywords: ["slack", "message", "dm", "direct", "workspace", "channel"],
  },
  {
    id: "desktop-message-discord",
    intent: "Send a message on Discord desktop app",
    example_queries: [
      "message {recipient} on discord {message}",
      "discord {recipient} {message}",
      "dm {recipient} on discord {message}",
      "send discord message to {recipient} {message}",
    ],
    category: "desktop_action",
    action: "send_message",
    app_hint: "Discord",
    execution_steps: [
      "1. Open Discord application",
      "2. Navigate to DMs section",
      "3. Search for user or click existing DM",
      "4. Click in message input",
      "5. Type the message",
      "6. Press Enter to send",
    ],
    parameters: ["app_name", "contact", "message"],
    keywords: ["discord", "message", "dm", "server", "channel"],
  },
  {
    id: "desktop-message-telegram",
    intent: "Send a message on Telegram desktop app",
    example_queries: [
      "telegram {recipient} {message}",
      "message {recipient} on telegram {message}",
      "send telegram to {recipient} {message}",
    ],
    category: "desktop_action",
    action: "send_message",
    app_hint: "Telegram",
    execution_steps: [
      "1. Open Telegram application",
      "2. Search for contact in search bar",
      "3. Click on contact to open chat",
      "4. Type message in input field",
      "5. Press Enter to send",
    ],
    parameters: ["app_name", "contact", "message"],
    keywords: ["telegram", "message", "send", "chat"],
  },
  {
    id: "desktop-message-generic",
    intent: "Send a message on any messaging application",
    example_queries: [
      "open {app} and send message to {recipient} {message}",
      "message {recipient} on {app} {message}",
      "tell {recipient} on {app} {message}",
      "send {recipient} a message on {app} saying {message}",
    ],
    category: "desktop_action",
    action: "send_message",
    execution_steps: [
      "1. Open the specified messaging app",
      "2. Search for or navigate to the contact",
      "3. Click on contact to open conversation",
      "4. Find and click message input field",
      "5. Type the message content",
      "6. Press Enter or click Send",
    ],
    parameters: ["app_name", "contact", "message"],
    keywords: ["message", "send", "tell", "text", "open", "and"],
  },

  // --- APPLICATION CONTROL PATTERNS ---
  {
    id: "desktop-open-app",
    intent: "Open or launch a desktop application",
    example_queries: ["open {app}", "launch {app}", "start {app}", "run {app}"],
    category: "desktop_action",
    action: "open_app",
    execution_steps: [
      "1. Use spotlight/launcher or direct app launch",
      "2. Wait for application window to appear",
      "3. Verify app is in foreground",
    ],
    parameters: ["app_name"],
    keywords: ["open", "launch", "start", "run", "app", "application"],
  },
  {
    id: "desktop-close-app",
    intent: "Close or quit a desktop application",
    example_queries: ["close {app}", "quit {app}", "exit {app}"],
    category: "desktop_action",
    action: "close_app",
    execution_steps: [
      "1. Find the application window",
      "2. Use Cmd+Q (macOS) or Alt+F4 (Windows) to quit",
      "3. Or click the close button",
    ],
    parameters: ["app_name"],
    keywords: ["close", "quit", "exit", "app", "application"],
  },
  {
    id: "desktop-switch-app",
    intent: "Switch focus to a different desktop application",
    example_queries: ["switch to {app}", "go to {app}", "focus {app}", "activate {app}"],
    category: "desktop_action",
    action: "switch_app",
    execution_steps: [
      "1. Use Cmd+Tab (macOS) or Alt+Tab (Windows)",
      "2. Or click app in dock/taskbar",
      "3. Verify app window is now focused",
    ],
    parameters: ["app_name"],
    keywords: ["switch", "focus", "activate", "go", "app"],
  },

  // --- UI INTERACTION PATTERNS ---
  {
    id: "desktop-click-element",
    intent: "Click on a UI element in an application",
    example_queries: [
      "click {element}",
      "click on {element}",
      "press {element}",
      "tap {element}",
      "select {element}",
    ],
    category: "desktop_action",
    action: "click",
    execution_steps: [
      "1. Get UI tree from accessibility API",
      "2. Find element by description/role/title",
      "3. Get element coordinates",
      "4. Move mouse to element center",
      "5. Perform click",
    ],
    parameters: ["element"],
    keywords: ["click", "press", "tap", "select", "button", "element"],
  },
  {
    id: "desktop-type-text",
    intent: "Type text into a field or application",
    example_queries: [
      "type {text} into {element}",
      "enter {text} in {element}",
      "write {text} in {element}",
      "input {text} into {element}",
    ],
    category: "desktop_action",
    action: "type",
    execution_steps: [
      "1. Find the target text field",
      "2. Click to focus the field",
      "3. Clear existing content if needed",
      "4. Type the text character by character",
    ],
    parameters: ["text", "element"],
    keywords: ["type", "enter", "write", "input", "text", "field"],
  },
  {
    id: "desktop-keyboard-shortcut",
    intent: "Execute a keyboard shortcut",
    example_queries: [
      "press {shortcut}",
      "hit {shortcut}",
      "keyboard shortcut {shortcut}",
      "do {shortcut}",
    ],
    category: "desktop_action",
    action: "press_shortcut",
    execution_steps: [
      "1. Parse shortcut string (e.g., cmd+c, ctrl+v)",
      "2. Press modifier keys (cmd/ctrl/alt/shift)",
      "3. Press the main key",
      "4. Release all keys",
    ],
    parameters: ["shortcut"],
    keywords: ["press", "shortcut", "keyboard", "cmd", "ctrl", "alt", "shift"],
  },
  {
    id: "desktop-scroll",
    intent: "Scroll within an application",
    example_queries: [
      "scroll {direction}",
      "scroll {direction} in {element}",
      "scroll to {element}",
    ],
    category: "desktop_action",
    action: "scroll",
    execution_steps: [
      "1. Identify scroll target (page or element)",
      "2. Use scroll wheel simulation",
      "3. Or use Page Up/Down keys",
    ],
    parameters: ["direction", "element"],
    keywords: ["scroll", "up", "down", "page"],
  },

  // --- CALENDAR/PRODUCTIVITY PATTERNS ---
  {
    id: "desktop-calendar-event",
    intent: "Create a calendar event in the Calendar app",
    example_queries: [
      "add event {title} on {date}",
      "create calendar event {title} for {date}",
      "schedule {title} on {date}",
      "add {title} to calendar on {date}",
      "put {title} on my calendar for {date}",
    ],
    category: "desktop_action",
    action: "create_event",
    app_hint: "Calendar",
    execution_steps: [
      "1. Open Calendar application",
      "2. Press Cmd+N for new event",
      "3. Enter event title",
      "4. Set date and time",
      "5. Click Save/Done",
    ],
    parameters: ["title", "date", "time"],
    keywords: ["calendar", "event", "schedule", "add", "create", "meeting", "appointment"],
  },
  {
    id: "desktop-reminder",
    intent: "Create a reminder in the Reminders app",
    example_queries: [
      "remind me to {task}",
      "create reminder {task}",
      "add reminder {task}",
      "set reminder for {task}",
    ],
    category: "desktop_action",
    action: "create_reminder",
    app_hint: "Reminders",
    execution_steps: [
      "1. Open Reminders application",
      "2. Click to add new reminder",
      "3. Type reminder text",
      "4. Set due date/time if specified",
      "5. Press Enter to save",
    ],
    parameters: ["task", "date", "time"],
    keywords: ["remind", "reminder", "task", "todo", "remember"],
  },
  {
    id: "desktop-notes",
    intent: "Create or open a note in the Notes app",
    example_queries: [
      "create note {title}",
      "new note {title}",
      "write note about {topic}",
      "open notes and write {content}",
    ],
    category: "desktop_action",
    action: "create_note",
    app_hint: "Notes",
    execution_steps: [
      "1. Open Notes application",
      "2. Press Cmd+N for new note",
      "3. Type note title/content",
    ],
    parameters: ["title", "content"],
    keywords: ["note", "notes", "write", "create", "jot"],
  },

  // --- MUSIC/MEDIA PATTERNS ---
  {
    id: "desktop-music-play",
    intent: "Play music or media content",
    example_queries: ["play {song}", "play music", "play {artist}", "start playing {content}"],
    category: "desktop_action",
    action: "play_media",
    app_hint: "Music",
    execution_steps: [
      "1. Open Music/Spotify app",
      "2. Search for content if specified",
      "3. Click play button",
    ],
    parameters: ["content", "app_name"],
    keywords: ["play", "music", "song", "artist", "album", "spotify", "apple music"],
  },
  {
    id: "desktop-music-control",
    intent: "Control music playback (pause, skip, etc.)",
    example_queries: ["pause music", "stop music", "next song", "previous song", "skip"],
    category: "desktop_action",
    action: "control_media",
    execution_steps: [
      "1. Use media keys (play/pause, next, previous)",
      "2. Or send command to music app",
    ],
    parameters: ["control_action"],
    keywords: ["pause", "stop", "skip", "next", "previous", "music"],
  },

  // --- SYSTEM CONTROL PATTERNS ---
  {
    id: "desktop-screenshot",
    intent: "Take a screenshot of the screen",
    example_queries: [
      "take screenshot",
      "screenshot",
      "capture screen",
      "take a picture of the screen",
    ],
    category: "desktop_action",
    action: "screenshot",
    execution_steps: [
      "1. Use Cmd+Shift+3 (full screen) or Cmd+Shift+4 (selection)",
      "2. Screenshot saved to Desktop",
    ],
    parameters: ["type"],
    keywords: ["screenshot", "capture", "screen", "picture"],
  },
  {
    id: "desktop-settings",
    intent: "Open system settings or app preferences",
    example_queries: ["open settings", "open preferences", "go to settings", "open {app} settings"],
    category: "desktop_action",
    action: "open_settings",
    execution_steps: [
      "1. Open System Preferences/Settings",
      "2. Or use Cmd+, in app for app preferences",
    ],
    parameters: ["app_name"],
    keywords: ["settings", "preferences", "system", "config", "options"],
  },
  {
    id: "desktop-volume",
    intent: "Adjust system audio volume",
    example_queries: [
      "volume up",
      "volume down",
      "mute",
      "set volume to {level}",
      "turn up the volume",
    ],
    category: "desktop_action",
    action: "adjust_volume",
    execution_steps: ["1. Use volume keys (F11/F12 on Mac)", "2. Or use system volume control"],
    parameters: ["direction", "level"],
    keywords: ["volume", "mute", "sound", "audio", "up", "down"],
  },
  {
    id: "desktop-brightness",
    intent: "Adjust screen brightness",
    example_queries: [
      "brightness up",
      "brightness down",
      "increase brightness",
      "decrease brightness",
    ],
    category: "desktop_action",
    action: "adjust_brightness",
    execution_steps: ["1. Use brightness keys (F1/F2 on Mac)", "2. Or use display settings"],
    parameters: ["direction"],
    keywords: ["brightness", "screen", "display", "up", "down"],
  },
];

/**
 * Search for matching patterns using Vectorize
 *
 * GENERALIZATION:
 * User queries are generalized before embedding to match stored patterns:
 *   "Forward the budget report to john@company.com"
 *   → "forward {document} to {email}"
 *   → matches stored "forward {document} to {recipient}" ✓
 *
 * @param {Object} env - Cloudflare worker environment with PATTERNS binding
 * @param {string} userIntent - Natural language description of what user wants
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Matching patterns with scores
 */
export async function searchPatterns(env, userIntent, options = {}) {
  const { topK = 3, minScore = 0.75, category = null } = options;

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERALIZE USER QUERY: Convert specific values to placeholders
  // "Forward the budget spreadsheet to john@company.com"
  // → "forward {document} to {email}"
  // This matches against generalized stored patterns!
  // ═══════════════════════════════════════════════════════════════════════════
  const { generalized: generalizedQuery, extractions } = generalizePattern(userIntent);

  // If Vectorize is not available, fall back to keyword matching
  if (!env.PATTERNS) {
    console.log("Vectorize not available, using keyword fallback");
    return keywordFallbackSearch(userIntent, topK, minScore, category);
  }

  try {
    // Get embedding for GENERALIZED user intent using Workers AI
    const embedding = await getEmbedding(env, generalizedQuery);

    // Query Vectorize
    const results = await env.PATTERNS.query(embedding, {
      topK,
      returnMetadata: true,
      filter: category ? { category } : undefined,
    });

    // Filter by minimum score and format results
    // Include execution_steps and parameters for LLM guidance
    const matches = results.matches
      .filter((match) => match.score >= minScore)
      .map((match) => ({
        id: match.id,
        score: match.score,
        category: match.metadata?.category,
        action: match.metadata?.action, // Action type (send_message, open_app, etc.)
        intent: match.metadata?.intent,
        generalized_intent: match.metadata?.generalized_intent,
        // EXECUTION SCAFFOLD - guides LLM on how to execute
        execution_steps: match.metadata?.execution_steps,
        parameters: match.metadata?.parameters, // Expected parameters to extract
        app_hint: match.metadata?.app_hint, // Suggested app for this action
        example_queries: match.metadata?.example_queries, // Similar phrasings
        // Include extraction info so caller knows what values were extracted
        query_extractions: Object.keys(extractions).length > 0 ? extractions : undefined,
      }));

    return matches;
  } catch (error) {
    console.error("Vectorize search failed:", error);
    return keywordFallbackSearch(userIntent, topK, minScore, category);
  }
}

/**
 * Get embedding for text using Workers AI
 */
async function getEmbedding(env, text) {
  if (!env.AI) {
    throw new Error("Workers AI not available");
  }

  const response = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  });

  return response.data[0];
}

/**
 * Fallback keyword-based search when Vectorize is unavailable
 * Also uses generalization for better matching
 */
function keywordFallbackSearch(userIntent, topK, minScore, category) {
  // Generalize user intent for better matching
  const { generalized: generalizedIntent, extractions } = generalizePattern(userIntent);
  const intentLower = generalizedIntent;
  const words = intentLower.split(/\s+/);

  const scored = TASK_PATTERNS.filter((p) => !category || p.category === category)
    .map((pattern) => {
      // Generalize pattern intent too
      const { generalized: generalizedPatternIntent } = generalizePattern(pattern.intent);

      // Calculate keyword overlap score
      const keywordMatches = pattern.keywords.filter(
        (kw) => intentLower.includes(kw) || words.some((w) => w.includes(kw) || kw.includes(w)),
      );

      // Check generalized intent similarity (placeholder-aware)
      const patternWords = generalizedPatternIntent.split(/\s+/);
      const intentMatches = words.filter((w) =>
        patternWords.some(
          (pw) =>
            pw.includes(w) ||
            w.includes(pw) ||
            // Match placeholders: {document} matches {document}
            (w.startsWith("{") && pw.startsWith("{") && w === pw),
        ),
      );

      const keywordScore = keywordMatches.length / pattern.keywords.length;
      const intentScore = intentMatches.length / Math.max(words.length, 1);
      const score = Math.min((keywordScore * 0.6 + intentScore * 0.4) * 1.5, 1.0);

      return {
        id: pattern.id,
        score,
        category: pattern.category,
        action: pattern.action, // Action type (send_message, open_app, etc.)
        intent: pattern.intent,
        generalized_intent:
          generalizedPatternIntent !== pattern.intent.toLowerCase().trim()
            ? generalizedPatternIntent
            : undefined,
        // EXECUTION SCAFFOLD - guides LLM on how to execute
        execution_steps: pattern.execution_steps,
        parameters: pattern.parameters,
        app_hint: pattern.app_hint,
        example_queries: pattern.example_queries?.slice(0, 3),
        query_extractions: Object.keys(extractions).length > 0 ? extractions : undefined,
      };
    })
    .filter((p) => p.score >= minScore)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

/**
 * Get full pattern details by ID
 *
 * @param {string} patternId - Pattern ID to retrieve
 * @returns {Promise<Object>} Full pattern with execution flow
 */
export async function getPatternDetails(patternId) {
  // In production, this would fetch from R2 or KV
  // For now, return pattern ID for client to fetch
  return {
    id: patternId,
    patternFile: `patterns/${patternId.replace(/-/g, "_")}.json`,
    message: "Fetch full pattern from /data/vectorize_patterns/patterns/",
  };
}

/**
 * Populate Vectorize index with pattern embeddings
 * Run this once to initialize or update the index
 *
 * GENERALIZATION:
 * Each pattern's intent is generalized before embedding:
 *   "Forward the quarterly report email to the finance team"
 *   → "forward {document} to {recipient}"
 *
 * This enables matching user queries like:
 *   "Forward the budget spreadsheet to john@company.com"
 *   → generalized → "forward {document} to {email}"
 *   → matches "forward {document} to {recipient}" ✓
 *
 * Usage: wrangler d1 execute centris-db --command="SELECT 1" && node -e "..."
 * Or call via admin endpoint
 */
export async function populatePatterns(env) {
  if (!env.PATTERNS || !env.AI) {
    throw new Error("Vectorize and AI bindings required");
  }

  const vectors = [];
  const debug = {
    embeddingsGenerated: 0,
    embeddingDimensions: null,
    generalizations: [], // Track what was generalized
    errors: [],
  };

  for (const pattern of TASK_PATTERNS) {
    try {
      // ═══════════════════════════════════════════════════════════════════════════
      // GENERALIZE INTENT: Convert specific values to placeholders
      // "Forward an email with specific attachments to multiple recipients"
      // → "forward an email with specific attachments to multiple {recipient}"
      // ═══════════════════════════════════════════════════════════════════════════
      const { generalized: generalizedIntent, extractions } = generalizePattern(pattern.intent);

      // ═══════════════════════════════════════════════════════════════════════════
      // INCLUDE EXAMPLE QUERIES: Add generalized example queries for better matching
      // Example queries like "buy {quantity} items from {retailer}" help the
      // embedding capture more query variations
      // ═══════════════════════════════════════════════════════════════════════════
      const exampleQueries = pattern.example_queries || [];
      const generalizedExamples = exampleQueries.map((q) => {
        // Example queries may already be generalized (contain {placeholders})
        // Only generalize if they don't already have placeholders
        if (q.includes("{")) {
          return q;
        }
        return generalizePattern(q).generalized;
      });

      // Create rich text for embedding using:
      // 1. GENERALIZED intent (main matching)
      // 2. Example queries (alternative phrasings)
      // 3. Keywords (important terms)
      const textForEmbedding = [
        generalizedIntent,
        ...generalizedExamples,
        `Keywords: ${pattern.keywords.join(", ")}`,
      ].join(". ");

      // Track generalization for debugging
      if (generalizedIntent !== pattern.intent.toLowerCase().trim()) {
        debug.generalizations.push({
          pattern: pattern.id,
          original: pattern.intent,
          generalized: generalizedIntent,
          extractions,
          example_queries: generalizedExamples,
        });
      }

      // Get embedding
      const embedding = await getEmbedding(env, textForEmbedding);

      if (!embedding || !Array.isArray(embedding)) {
        debug.errors.push(`Pattern ${pattern.id}: embedding not an array`);
        continue;
      }

      if (debug.embeddingDimensions === null) {
        debug.embeddingDimensions = embedding.length;
      }

      debug.embeddingsGenerated++;

      vectors.push({
        id: pattern.id,
        values: embedding,
        metadata: {
          category: pattern.category,
          action: pattern.action || null, // Action type (send_message, open_app, etc.)
          intent: pattern.intent, // Original intent for display
          generalized_intent: generalizedIntent, // Generalized for matching
          keywords: pattern.keywords.join(","),
          example_count: exampleQueries.length, // Track how many examples
          // EXECUTION SCAFFOLD - guides LLM on how to execute
          execution_steps: pattern.execution_steps ? JSON.stringify(pattern.execution_steps) : null,
          parameters: pattern.parameters ? pattern.parameters.join(",") : null,
          app_hint: pattern.app_hint || null, // Suggested app for this action
          example_queries:
            exampleQueries.length > 0 ? JSON.stringify(exampleQueries.slice(0, 3)) : null,
          type: pattern.category === "desktop_action" ? "desktop_pattern" : "task_pattern",
        },
      });
    } catch (error) {
      debug.errors.push(`Pattern ${pattern.id}: ${error.message}`);
    }
  }

  if (vectors.length === 0) {
    return {
      success: false,
      error: "No vectors generated",
      debug,
    };
  }

  // Insert into Vectorize
  try {
    const result = await env.PATTERNS.upsert(vectors);
    return {
      success: true,
      patternsIndexed: vectors.length,
      generalizedCount: debug.generalizations.length,
      debug,
      result,
    };
  } catch (error) {
    return {
      success: false,
      error: `Vectorize upsert failed: ${error.message}`,
      debug,
    };
  }
}

/**
 * API handler for pattern search endpoint
 *
 * GENERALIZATION:
 * The user's intent is automatically generalized before searching:
 *   Input: "Forward the quarterly report to alice@company.com"
 *   Generalized: "forward {document} to {email}"
 *   Extractions: { documents: ["quarterly report"], emails: ["alice@company.com"] }
 *   → Matches stored task patterns with similar generalized structure
 */
export async function handlePatternSearch(request, env) {
  try {
    const body = await request.json();
    const { intent, category, topK = 3, minScore = 0.7 } = body;

    if (!intent) {
      return new Response(
        JSON.stringify({
          error: "Missing required field: intent",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Get generalized version for response
    const { generalized, extractions } = generalizePattern(intent);

    const matches = await searchPatterns(env, intent, {
      topK,
      minScore,
      category,
    });

    return new Response(
      JSON.stringify({
        success: true,
        query: intent,
        generalized_query: generalized !== intent.toLowerCase().trim() ? generalized : undefined,
        extractions: Object.keys(extractions).length > 0 ? extractions : undefined,
        matches,
        matchCount: matches.length,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
