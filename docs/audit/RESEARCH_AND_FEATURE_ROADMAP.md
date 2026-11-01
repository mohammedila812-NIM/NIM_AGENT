# NIM AGENT — EXTERNAL RESEARCH & FEATURE ROADMAP

**Project:** NIM Agent (Autonomous AI Browser Assistant)  
**Package Version:** `1.4.1`  
**Audit Date:** October 25, 2026  
**Auditor:** Principal Software Engineer, Senior Architect & Security Auditor  

---

## 1. External Research Findings & Comparative Evaluation

This research was conducted using official Chromium specifications, Chrome Extensions Manifest V3 guidelines, GitHub security advisories, and state-of-the-art autonomous browser agent SDKs (Stagehand, Browser-Use, Playwright).

### 1.1 Chrome Extensions Manifest V3: `chrome.alarms` Lifecycle & Constraints
- **Primary Source:** [Chrome Developers — Alarms API Reference](https://developer.chrome.com/docs/extensions/reference/api/alarms) & [Chrome MV3 Migration Guide](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- **Key Finding:** In Google Chrome Manifest V3 production extensions, `chrome.alarms` enforces a strict minimum threshold of **30 seconds (`periodInMinutes: 0.5`)** (or 60 seconds in earlier Chrome versions). Any `periodInMinutes` value lower than 0.5 is clamped by the browser and produces a runtime warning. Furthermore, the Service Worker lifecycle is designed to sleep after 30 seconds of inactivity; Chrome will not wake sleeping workers more frequently than the alarm threshold allows.
- **Project Relevance:** In [`src/lib/storage/watch.ts`](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/src/lib/storage/watch.ts#L119), the project assumes `periodInMinutes: 1 / 60` (1 second) or `20 / 60` (20 seconds) is supported in background watch mode. This works only during local unpacked development; in production, alarms are clamped.
- **Architectural Directive:** Clamp minimum monitor intervals to 60 seconds for background alarms. For sub-minute polling while the user has the browser open, use an active Side Panel or `chrome.offscreen` document.

### 1.2 Chrome Extensions Manifest V3: `chrome.offscreen` Documents
- **Primary Source:** [Chrome Developers — Offscreen Documents API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- **Key Finding:** Manifest V3 replaces background pages with headless Service Workers, which lack DOM access (`window`, `document`, `DOMParser`, `Audio`, `Canvas`, `iframe`). To perform tasks requiring DOM or continuous audio/worker lifecycles, Chrome provides `chrome.offscreen.createDocument()`. Offscreen documents run on an isolated origin with full DOM access and communicate with the service worker via `chrome.runtime.sendMessage`.
- **Project Relevance:** Currently, `CodingSpacePanel.tsx` executes sandboxed code inside an iframe directly in the side panel, and `deep-research.ts` strips HTML via regex. An offscreen document provides a dedicated, isolated execution context for:
  1. Sandboxed JavaScript & WebAssembly execution (Pyodide).
  2. DOM parsing via native `DOMParser` without launching full browser tabs.
  3. Audio playback and speech synthesis for voice briefings.

### 1.3 Chrome Built-in AI & On-Device Prompt API (`LanguageModel` / Gemini Nano)
- **Primary Source:** [Google Chrome Built-in AI Documentation](https://developer.chrome.com/docs/ai/built-in) & [W3C Web Incubator Prompt API](https://github.com/explainers-by-googlers/prompt-api)
- **Key Finding:** Chrome 128+ introduces on-device Gemini Nano accessible via the `window.LanguageModel` (or `chrome.aiOriginTrial.languageModel`) interface. It executes 100% locally on the user's NPU/GPU/CPU with zero latency, zero network requests, zero token costs, and total data privacy.
- **Project Relevance:** NIM Agent currently spends cloud LLM tokens on passive background tasks (such as `extractAndStoreEntities` in `entity-extractor.ts` and `sanitizeWithQuarantine` in `quarantine.ts`). Shifting these background safety and knowledge extraction routines to local Gemini Nano will reduce API costs to zero for secondary tasks, eliminate rate limit collisions, and deliver near-instant extraction.

### 1.4 State-of-the-Art Browser Agents: Stagehand & Browser-Use Patterns
- **Primary Source:** [Stagehand Architecture (Browserbase)](https://github.com/browserbase/stagehand) & [Browser-Use Core Architecture](https://github.com/browser-use/browser-use)
- **Key Finding:** Leading browser agents have evolved past brittle `document.querySelector` scripts and heavy pure-vision loops:
  1. **CDP-First Actuation:** Interacting via Chrome DevTools Protocol (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`) guarantees real browser event dispatch that cannot be occluded by floating banners or broken by synthetic event blockers.
  2. **Accessibility-Tree & Affordance Filtering:** Rather than dumping the entire DOM tree, modern agents extract interactive affordances (buttons, inputs, links) categorized with role and label, keeping token usage under 1,500 tokens per step.
  3. **Mutation Settling Gates:** Stagehand relies on mutation-observer idle gates to prevent clicking or typing while single-page apps are transitioning.

---

## 2. Competitive Matrix

| Capability / Dimension | NIM Agent (Current v1.4.1) | Stagehand (Browserbase) | Browser-Use (Python) | NIM Agent (Target v2.0) |
|---|---|---|---|---|
| **Runtime Environment** | 100% In-Browser (Chrome MV3) | Node.js / Cloud Server | Python / Local Machine | 100% In-Browser (Chrome MV3 + Offscreen) |
| **External Server Dependency** | Zero (Client-side) | High (Requires Node runner) | High (Requires Python/Playwright) | Zero (Client-side native) |
| **Persistent Workspace** | IndexedDB VFS (`/notes`, `/research`, etc.) | None (Ephemeral) | File system on disk | IndexedDB VFS + GitHub Sync + ZIP Export |
| **Research Engine** | Timed autonomous crawler with live notes | Step-by-step programmatic | Loop-driven | Timed crawler + Multi-tab Swarm + On-Device Nano |
| **DOM Actuation** | Inline `executeScript` synthetic events | CDP Native via Playwright | CDP Native via Playwright | Hybrid: CDP (`chrome.debugger`) + Primitives |
| **Coding Environment** | In-browser sandboxed editor & live preview | None | Local code execution | Sandboxed JS/HTML + Pyodide Python Wasm |
| **Cost Control** | Token spending cap & session cost meter | None (Managed in cloud) | None | Budget Guard + Local Gemini Nano for zero-cost tasks |
| **Cross-Session Knowledge** | IndexedDB Graph ("NIM Brain") | None | None | Persistent Knowledge Graph with Vector Embeddings |

---

## 3. High-Value New Feature Roadmap

### Category A: Essential Improvements (Reliability, Safety & Integrity)

#### Feature A1: Unified CDP & Hardened Actuation Kernel
- **User Problem:** Synthetic JavaScript events (`element.click()`, `dispatchEvent`) are blocked by modern web apps (Cloudflare Turnstile, React synthetic events, banking portals, floating sticky banners).
- **Why it belongs in NIM Agent:** NIM Agent claims "Indestructible Browser Actuation", yet currently relies on `document.querySelector` and synthetic events in `clicker.ts`.
- **Implementation Approach:** Implement a dual-mode actuation kernel: default to `chrome.scripting` primitives with verified focus and scrolling; automatically escalate to `chrome.debugger` (CDP `Input.dispatchMouseEvent`) when clicking fails or when interacting with canvas/SVG traps.
- **Affected Files:** `src/lib/agent/primitives/act.ts`, `src/lib/agent/tools/clicker.ts`, `src/entrypoints/background.ts`.
- **Complexity:** Medium | **Risk:** Requires `debugger` permission approval on Chrome Web Store.
- **Acceptance Criteria:** Successfully clicks occluded buttons, shadow-root inputs, and React 18 controlled components across 10 top test suites.

#### Feature A2: Fixed Abort Controller & Graceful Cancellation
- **User Problem:** Clicking "Stop" causes the agent to wait through exponential retries (up to 30 seconds) before halting.
- **Implementation Approach:** Catch `AbortError` in `client.ts` and terminate immediately without backoff. Disconnect running tabs and clear pending alarms.
- **Affected Files:** `src/lib/llm/client.ts`, `src/lib/agent/engine.ts`.
- **Complexity:** Low | **Risk:** Negligible.
- **Acceptance Criteria:** Agent stops within 150ms of user pressing "Stop".

---

### Category B: High-Value Features (Productivity & Usability)

#### Feature B1: Chrome Built-in AI (Gemini Nano) for Zero-Cost Passive Intelligence
- **User Problem:** Users burn paid API quota whenever NIM Agent runs background entity extraction or quarantine sanitization.
- **Why it belongs in NIM Agent:** Makes the extension truly lightweight and privacy-preserving.
- **External Research:** Chrome 128+ `window.LanguageModel` allows running inference on the user's device for free.
- **Implementation Approach:** Add a local Gemini Nano provider in `providers.ts`. Route `extractAndStoreEntities` and `sanitizeWithQuarantine` to `LanguageModel` when available.
- **Affected Files:** `src/lib/llm/providers.ts`, `src/lib/knowledge/entity-extractor.ts`, `src/lib/agent/quarantine.ts`.
- **Complexity:** Medium | **Risk:** Requires Chrome with built-in AI enabled.
- **Acceptance Criteria:** When Gemini Nano is available, zero API tokens are charged to the user's cloud provider for passive entity extraction.

#### Feature B2: Virtual Workspace Direct Sync (Export to GitHub & ZIP)
- **User Problem:** Files created in the VFS (`/code`, `/research`, `/notes`) are trapped in browser IndexedDB unless copied one by one.
- **Implementation Approach:** Add one-click "Export as ZIP" using lightweight client-side zip creation, and a "Publish to GitHub Gist / Repo" integration via GitHub personal access tokens.
- **Affected Files:** `src/lib/workspace/vfs.ts`, `src/entrypoints/sidepanel/components/WorkspacePanel.tsx`.
- **Complexity:** Medium | **Dependencies:** `jszip` (or lightweight native deflate).
- **Acceptance Criteria:** User can download an entire `/research/` folder as a formatted `.zip` with images and markdown intact.

---

### Category C: Competitive Advantages (Market Differentiators)

#### Feature C1: Voice Command & Audio Executive Briefings
- **User Problem:** Users conducting research while multitasking cannot easily listen to research summaries or issue quick voice commands.
- **Why it belongs in NIM Agent:** Elevates NIM Agent from a sidepanel text box to a genuine AI companion.
- **Implementation Approach:** Use browser-native `webkitSpeechRecognition` for speech-to-intent in `ChatPanel.tsx`; use `speechSynthesis` (or an offscreen Web Audio document) with natural inflection to read executive summaries.
- **Affected Files:** `src/entrypoints/sidepanel/components/ChatPanel.tsx`, `src/entrypoints/sidepanel/components/ResearchPanel.tsx`.
- **Complexity:** Low to Medium | **Risk:** Microphone permission prompt.
- **Acceptance Criteria:** One-click "Read Summary" button clearly synthesizes research findings into audio.

#### Feature C2: Multi-Tab Research Swarm with Dynamic Content Extraction
- **User Problem:** Timed deep research on single tabs is linear and slow. Crawling 10 pages sequentially takes several minutes.
- **Implementation Approach:** Fully connect `coordinator.ts` to spawn up to 4 background worker tabs in parallel, scraping orthogonal sources (pricing, reviews, specs, technical whitepapers) simultaneously and consolidating to the shared Blackboard.
- **Affected Files:** `src/lib/agent/swarm/coordinator.ts`, `src/entrypoints/sidepanel/components/ResearchPanel.tsx`.
- **Complexity:** High | **Risk:** Browser memory spikes if more than 4 tabs are opened.
- **Acceptance Criteria:** A 2-minute swarm research query crawls 8+ distinct domains and synthesizes a comparative table in under 60 seconds.

---

### Category D: Engineering & Infrastructure

#### Feature D1: Comprehensive CI/CD Pipeline & Playwright Persistent Fixtures
- **User Problem:** Broken configurations and regressions are merged unnoticed (e.g. `playwright.config.ts` crash).
- **Implementation Approach:** 
  1. Fix `playwright.config.ts` ESM `__dirname` bug.
  2. Update `extension-context.ts` to use `chromium.launchPersistentContext`.
  3. Create `.github/workflows/ci.yml` running lint, typecheck, vitest, and playwright on every commit.
- **Affected Files:** `playwright.config.ts`, `e2e/setup/extension-context.ts`, `.github/workflows/ci.yml`.
- **Complexity:** Low | **Risk:** None.
- **Acceptance Criteria:** Automated GitHub Actions pass cleanly with 100% green tests.

#### Feature D2: Modular Engine Decomposition
- **User Problem:** `engine.ts` is a 2,083-line monolith that creates high maintenance risk.
- **Implementation Approach:** Split into `ReActLoopController`, `ToolDispatcher`, `TriadManager`, and `DOMActuator`.
- **Affected Files:** `src/lib/agent/engine.ts`, `src/lib/agent/core/*`.
- **Complexity:** High | **Risk:** Regression if interfaces are modified.
- **Acceptance Criteria:** All 136 unit tests pass with zero change in external agent behavior.

---

### Category E: Experimental Opportunities

#### Feature E1: In-Browser Python Data Science via Pyodide WebAssembly
- **User Problem:** In Coding Space, users can only execute JavaScript. Data science tasks (pandas, numpy, CSV data cleaning) cannot be run in-browser.
- **Implementation Approach:** Load Pyodide Wasm inside a dedicated `chrome.offscreen` document. Connect Coding Space editor to Pyodide worker via postMessage.
- **Affected Files:** `src/lib/code-runner/pyodide-runner.ts`, `src/entrypoints/sidepanel/components/CodingSpacePanel.tsx`.
- **Complexity:** High | **Risk:** 15MB initial Wasm download.
- **Acceptance Criteria:** User can run `import pandas as pd` and analyze workspace CSV files directly in Chrome.

---

## 4. Execution Phases & Milestones

### Phase 1: Stabilization & Critical Fixes (COMPLETED)
- **Status:** **100% COMPLETE & VERIFIED**
- Task A: Fixed script-injection vulnerability in `runner.ts` using cryptographic nonce and postMessage.
- Task B: Remediated `tinypool <= 2.1.1` RCE advisory via package override.
- Task C: Fixed LLM request cancellation in `client.ts` and `engine.ts` (`signal?: AbortSignal`, immediate throw on `AbortError`).
- Task D: Restored Playwright E2E harness in `playwright.config.ts` (ESM `fileURLToPath`) and persistent context fixtures.
- Task E: Synchronized watch engine assertion formats in `watch-engine.test.ts`.
- Task F: Synchronized manifest version to `1.4.1` and installed ESLint developer tooling.
- Deliverables: `docs/audit/PHASE_1_IMPLEMENTATION_REPORT.md` and `docs/audit/PHASE_1_TEST_RESULTS.md`.

### Phase 2: Platform Compliance, Quality & Infrastructure (COMPLETED)
- **Status:** **100% COMPLETE & VERIFIED**
- Task 2.1: Disambiguated `parseDuration` in `watch.ts` (bare numbers default to minutes).
- Task 2.2: Enforced Chrome MV3 minimum background alarm interval (`MIN_MV3_ALARM_PERIOD_MINUTES = 0.5`, 30s) in `watch.ts`.
- Task 2.3: Added token budget checking (`checkBudget`) and recording (`recordUsage`) to `extractAndStoreEntities`.
- Task 2.4: Upgraded `e2e/security/injection-suite.spec.ts` with real DOM page injection.
- Task 2.5: Created `.github/workflows/ci.yml` with type-check, lint, vitest, and playwright jobs.
- Task 2.6: Compressed image assets (`logo.jpg` -97%, `icon.png` -78%), reducing package bundle size from 1.91 MB to 840 kB (-56%).
- Deliverables: `docs/audit/PHASE_2_IMPLEMENTATION_REPORT.md` and `docs/audit/PHASE_2_TEST_RESULTS.md`.

### Phase 3: Architectural Refactoring & Engine Decomposition (COMPLETED)
- **Status:** **100% COMPLETE & VERIFIED**
- Task 3.1: Decomposed monolithic `engine.ts` (2,102 lines) into `ReActLoopController`, `ToolDispatcher`, and `TriadCoordinator`, maintaining `AgentEngine` as a 60-line public façade.
- Task 3.2: Consolidated orphaned content script kernel (`src/entrypoints/content.ts`) into Manifest V3 static registration and standardized engine DOM observation on `primitives/observe.ts` and `act.ts`.
- Task 3.3: Implemented selective quarantine scanning and rigid XML structural demarcation (`processUntrustedPageContent`, `<untrusted_external_content>`), preserving 100% of tabular data and page content.
- Task 3.4: Hardened deep research raw fetch in `deep-research.ts` with HTML entity decoding, Content-Type binary filtering, and client-rendered SPA fallback.
- Deliverables: `docs/audit/PHASE_3_IMPLEMENTATION_REPORT.md` and `docs/audit/PHASE_3_TEST_RESULTS.md`.

### Phase 4: Open-Source Growth, Viral Capabilities & Developer Superpowers (IN PROGRESS)
- **Status:** **ACTIVE IMPLEMENTATION**
- **Task 4.1: Prompt-to-Playwright Automation Code Generator:**
  - Convert agent action histories into clean, executable Playwright TypeScript and Python test scripts.
  - Automatically exports to `/code/automation.spec.ts` in the Virtual Workspace or user clipboard.
- **Task 4.2: Automated Extension Release ZIP Pipeline:**
  - Create `.github/workflows/release.yml` to package and attach ready-to-use extension `.zip` bundles to GitHub Releases for zero-friction installation.
- **Task 4.3: Virtual Workspace Direct Exporter:**
  - Export VFS folders as structured ZIP bundles and GitHub Gist payloads.
- **Task 4.4: Cinematic "Ghost Cursor" & Visual Action Trails:**
  - Smooth animated cursor element in `page-effects.ts` with micro-thought tooltips and click ripple pulses for high-impact social demos and user feedback.
- **Task 4.5: Repository Presentation & Growth Engineering Overhaul:**
  - Overhaul `README.md` with comparison matrix (vs Browser-Use & Stagehand), Mermaid architecture diagrams, badges, and quickstart presets.

