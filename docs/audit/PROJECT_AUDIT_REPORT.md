# NIM AGENT — COMPREHENSIVE ENGINEERING AUDIT & ARCHITECTURAL REPORT

**Project:** NIM Agent (Autonomous AI Browser Assistant)  
**Repository Working Copy:** `c:\Users\maham\Desktop\NIM_AGENT-1.1.0`  
**Package Version:** `1.4.1` (Manifest: `1.4.0`)  
**Audit Date:** October 25, 2026  
**Auditing Team:** Principal Software Engineer, Senior Architect, Security Auditor, Performance Engineer & QA Lead  
**Audit Standard:** Antigravity Autonomous Systems Engineering Methodology (Read-Only Static Analysis, Dynamic Execution, and Comparative Research)  

---

## 1. Executive Summary

NIM Agent is an ambitious, full-featured in-browser autonomous AI agent extension built on Google Chrome Manifest V3, WXT, React 18, Vite, and TypeScript. Unlike simple API wrappers, NIM Agent embeds a **Virtual File System (VFS)**, an **In-Browser Sandboxed Coding Space**, an **Autonomous Timed Deep Research Crawler**, and a **Triad (Planner-Actor-Validator) Self-Healing Engine**.

This comprehensive engineering investigation inspected **100% of authored project files** (95 files discovered, 86 source/config files audited line-by-line, 9 static binary assets accounted for). The codebase demonstrates sophisticated engineering patterns (such as IndexedDB persistence, AST-based markdown parsing without `dangerouslySetInnerHTML`, and token budget guards). However, the audit uncovered **critical security vulnerabilities, platform constraint violations in Chrome Manifest V3 alarms, an entirely broken Playwright E2E test harness, and code duplication resulting from rapid feature evolution**.

### Key Investigation Metrics
- **Authored Code Coverage:** 100% (Every file inspected and cataloged)
- **TypeScript Static Verification:** Clean compilation (`tsc --noEmit` exited code 0)
- **Unit Test Execution:** 29 test files, 136 tests (28 passed, 1 failed: regression in `watch-engine.test.ts`)
- **E2E Test Execution:** 0% operational (`ReferenceError: __dirname is not defined in ES module scope`)
- **Security Findings:** 2 Critical (P0), 5 High (P1), 8 Medium (P2), 6 Low (P3), 6 Opportunities (P4)
- **Production Build:** Succeeded in 38.3s (1.91 MB bundle; 64% consumed by 2 uncompressed images)

---

## 2. System Architecture & Subsystem Mapping

```mermaid
graph TD
    User([User / Operator]) <-->|Side Panel UI / Alt+Shift+N| SidePanel[Side Panel Entrypoint]
    User <-->|Browser Context Menus| ContextMenu[Context Menu Handler]
    
    subgraph ExtensionCore["Extension Kernel (MV3 Service Worker)"]
        Background[background.ts Service Worker]
        PortMgr[Port Manager & Event Hub]
        Checkpointer[Crash Recovery & Checkpoint Store]
        AlarmScheduler[Alarm Scheduler - chrome.alarms]
    end

    subgraph AutonomousCore["Autonomous Agent Core (engine.ts)"]
        ReActLoop[ReAct Reasoning Loop]
        Quarantine[Anti-Injection Quarantine]
        CostGuard[Token & Cost Budget Guard]
        Triad[Planner - Spotlight - Reflector - Validator]
    end

    subgraph ToolsAndActuation["Actuation & Tools Layer"]
        Primitives[Stagehand-style Primitives: act.ts / observe.ts]
        ToolsRegistry[AGENT_TOOLS Registry (30+ tools)]
        Swarm[Swarm Multi-Tab Coordinator]
        DeepResearch[Timed Deep Research Runner]
    end

    subgraph BrowserDOM["Target Browser Web Pages"]
        ActiveTab[Active Tab Content]
        BackgroundTabs[Worker / Scrape Background Tabs]
    end

    subgraph StorageSubsystem["Persistent Storage Layer"]
        VFS[IndexedDB Virtual File System]
        Brain[IndexedDB Knowledge Graph]
        SecureStorage[chrome.storage.local Keys & Config]
    end

    SidePanel <-->|Streaming Port| PortMgr
    PortMgr --> Background
    Background --> ReActLoop
    AlarmScheduler --> Background
    Checkpointer <--> SecureStorage
    
    ReActLoop --> Quarantine
    ReActLoop --> CostGuard
    ReActLoop --> Triad
    ReActLoop --> ToolsRegistry
    
    ToolsRegistry --> Primitives
    ToolsRegistry --> Swarm
    ToolsRegistry --> DeepResearch
    
    Primitives <-->|chrome.scripting| ActiveTab
    Swarm <-->|chrome.tabs + scripting| BackgroundTabs
    DeepResearch <-->|fetch / tabs| BackgroundTabs
    
    ToolsRegistry <--> VFS
    ToolsRegistry <--> Brain
    ReActLoop <--> SecureStorage
```

### Major Subsystems
1. **Entrypoints (`src/entrypoints/`):**
   - `background.ts`: The central service worker. Manages runtime ports, alarm dispatch, tab lifecycle, crash recovery, and agent instantiation.
   - `sidepanel/`: Multi-tab React application (`ChatPanel`, `WorkspacePanel`, `CodingSpacePanel`, `ResearchPanel`, `WatchPanel`, `SettingsPanel`, `TracePanel`, `SecurityLog`).
   - `content.ts`: Orphaned content script kernel configured with runtime injection.
2. **Autonomous Agent Core (`src/lib/agent/`):**
   - `engine.ts`: Monolithic ReAct loop (2,083 lines) orchestrating LLM calls, tool execution, safety checks, and loop detection.
   - `triad/`: Planner-Actor-Validator triad providing milestone planning, CAPTCHA detection HUD, and self-healing fallback clicks.
   - `cost-guard.ts`: Tracks token consumption and enforces daily USD budgets.
   - `quarantine.ts`: LLM-based indirect prompt injection detector.
3. **Storage & Virtual Desktop (`src/lib/workspace/` & `src/lib/knowledge/`):**
   - `vfs.ts`: Persistent IndexedDB file system supporting `/notes`, `/research`, `/code`, `/data`, `/trash`.
   - `graph-db.ts`: "NIM Brain" entity-relationship store capped at 10,000 nodes.
4. **LLM Client Layer (`src/lib/llm/`):**
   - `client.ts`: Unified OpenAI-compatible fetch client with rate-limit retries, Google RPC retry parsing, and SSE streaming.

---

## 3. Critical Findings Summary

### 3.1 P0 — Critical Vulnerabilities
1. **Sandboxed Code Runner Script Injection ([FINDING-P0-02](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p0-02)):**
   In `src/lib/code-runner/runner.ts`, raw JavaScript code is interpolated directly into an HTML `<script>` tag via template string: `${code}`. Any code containing `</script>` breaks out of the tag, allowing arbitrary HTML markup and script execution inside the iframe.
2. **Dependency Remote Code Execution ([FINDING-P0-01](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p0-01)):**
   Transitive dependency `tinypool <= 2.1.1` contains prototype pollution gadgets leading to RCE in worker options during test execution (GHSA-5gmw-xhrv-c9v3).

### 3.2 P1 — High-Priority Defects
1. **Playwright E2E Suite Broken ([FINDING-P1-01](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p1-01)):**
   `playwright.config.ts` calls `path.resolve(__dirname, ...)`. In ESM (`"type": "module"`), `__dirname` is undefined, immediately crashing `npm run test:e2e`.
2. **Invalid Manifest V3 Alarm Assumptions ([FINDING-P1-02](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p1-02)):**
   `watch.ts` sets `periodInMinutes: 1 / 60` (1 second) and `20 / 60` (20 seconds). Chrome production releases strictly clamp alarms to **at least 30 seconds (0.5 minutes)** or 1 minute. Sub-minute background monitoring does not fire in packed extensions.
3. **Flawed Duration Parsing Heuristic ([FINDING-P1-03](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p1-03)):**
   In `watch.ts`, `raw < 60 ? raw : raw * 60` converts a 15-minute or 30-minute monitor into 15 or 30 *seconds*.
4. **LLM Client Retries User Abort Signals ([FINDING-P1-04](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p1-04)):**
   `client.ts` catches `AbortError` and retries up to 5 times with exponential backoff, ignoring user cancellation.
5. **Unmetered Entity Extraction Background Calls ([FINDING-P1-05](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p1-05)):**
   Every `web_search` fires an unmetered background LLM call via `extractAndStoreEntities`, completely bypassing `cost-guard` limits.

### 3.3 P2 — Medium Quality & Architectural Issues
1. **Orphaned Content Script & Massive Duplication ([FINDING-P2-04](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p2-04)):**
   `content.ts` is never registered or sent messages. Five separate implementations of DOM walking exist across `engine.ts`, `observe.ts`, `dom-reader.ts`, `act.ts`, and `content.ts`.
2. **Lossy Quarantine Sanitization ([FINDING-P2-05](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p2-05)):**
   `read_page` replaces full page text with LLM-extracted summary bullet points, blinding the agent to exact sentences, code snippets, or fine-grained table cells.
3. **Dummy Security Tests ([FINDING-P2-03](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p2-03)):**
   `e2e/security/injection-suite.spec.ts` defines 5 injection vectors but never injects them into a webpage, asserting only that the sidepanel title is "NIM Agent".
4. **Missing ESLint ([FINDING-P2-01](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md#finding-p2-01)):**
   `npm run lint` fails because `eslint` is not installed in `devDependencies`.

---

## 4. Test & Verification Analysis

### 4.1 Vitest Suite Execution
Command executed: `npm test` (`vitest run`)  
Results:
- **Test Files:** 28 passed, 1 failed (29 total)
- **Individual Tests:** 135 passed, 1 failed (136 total)
- **Duration:** 57.53s  
- **Failure Analysis:** `src/lib/agent/watch-engine.test.ts:28:26` failed because `watch-tools.ts` was edited to return `Every 15 minutes` instead of `Every 15 minute(s)`.

### 4.2 Playwright E2E Execution
Command executed: `npx playwright test --list`  
Results:
- **Status:** Complete runtime failure before test collection.
- **Root Cause:** `ReferenceError: __dirname is not defined in ES module scope` in `playwright.config.ts`.
- **Harness Gap:** Fixture uses `browser.newContext()` which does not load Chromium MV3 extensions; must use `chromium.launchPersistentContext`.

---

## 5. Security & Threat Modeling (STRIDE)

| Threat | Component Affected | Attack Path | Mitigation & Fix |
|---|---|---|---|
| **Spoofing** | Background Worker | Foreign extension sends `AGENT_START` | **Passed:** `sender.id !== chrome.runtime.id` enforced in `background.ts`. |
| **Tampering** | ReAct Loop / DOM | Indirect prompt injection in web page | **Medium:** Fenced with `<untrusted_external_content>`; replace lossy quarantine with rigid XML tags. |
| **Repudiation** | Tool Execution | Agent takes unrecorded actions | **Passed:** `audit-log.ts` persists all actions and HITL approvals. |
| **Information Disclosure** | API Keys | Malicious web page attempts to read keys | **Passed:** Keys stored in `chrome.storage.local` (inaccessible to web pages). |
| **Denial of Service** | LLM Client & Alarms | Infinite action loops / sub-minute alarms | **Medium:** Loop detector works, but sub-minute alarm heuristic causes spam; fix `parseDuration`. |
| **Elevation of Privilege** | Coding Space | Malicious script escapes iframe sandbox | **Vulnerable (P0):** Fix string interpolation in `runner.ts`. |

---

## 6. Phased Implementation Roadmap

```mermaid
graph LR
    Stage1["Stage 1: Immediate Security & Fixes (Week 1)"] --> Stage2["Stage 2: Platform Compliance & Tooling (Week 2)"]
    Stage2 --> Stage3["Stage 3: Architectural Refactoring (Week 3)"]
    Stage3 --> Stage4["Stage 4: Strategic High-Value Features (Week 4)"]
    Stage4 --> Stage5["Stage 5: Polish & Ecosystem (Week 5)"]
```

### Stage 1: Immediate Security & Fixes (Priority: P0/P1)
- [ ] **Task 1.1:** Patch `src/lib/code-runner/runner.ts` using JSON serialization and `Blob` execution to prevent `<script>` tag breakout.
- [ ] **Task 1.2:** Update `package-lock.json` overrides to resolve `tinypool` and `zod` security advisories.
- [ ] **Task 1.3:** Fix `playwright.config.ts` ESM `__dirname` error using `import.meta.url`.
- [ ] **Task 1.4:** Fix `client.ts` to immediately throw `AbortError` without exponential retries.
- [ ] **Task 1.5:** Fix `watch-engine.test.ts` assertion regression.

### Stage 2: Platform Compliance & Quality (Priority: P1/P2)
- [ ] **Task 2.1:** Fix `parseDuration` in `watch.ts` to default bare numbers to minutes.
- [ ] **Task 2.2:** Enforce Chrome MV3 60s minimum interval for background alarms.
- [ ] **Task 2.3:** Install and configure ESLint in `package.json`.
- [ ] **Task 2.4:** Update `e2e/security/injection-suite.spec.ts` with real DOM injection fixtures.
- [ ] **Task 2.5:** Setup `.github/workflows/ci.yml` for automated CI validation.

### Stage 3: Architectural Refactoring (Priority: P2)
- [ ] **Task 3.1:** Decompose `engine.ts` into `ReActLoopController`, `ToolDispatcher`, and `TriadCoordinator`.
- [ ] **Task 3.2:** Consolidate duplicate DOM walkers onto `src/lib/agent/primitives/observe.ts` and `act.ts`.
- [ ] **Task 3.3:** Replace lossy quarantine extraction with structured XML demarcation.
- [ ] **Task 3.4:** Optimize `public/icon.png` and `public/logo.jpg` to reduce bundle size by 60%.

### Stage 4: Strategic High-Value Features (Priority: P4)
- [ ] **Task 4.1:** Integrate Chrome on-device Gemini Nano (`window.LanguageModel`) for zero-cost entity extraction.
- [ ] **Task 4.2:** Introduce `chrome.offscreen` document for sandboxed code execution and background processing.
- [ ] **Task 4.3:** Add VFS Export to GitHub & ZIP archive download.
- [ ] **Task 4.4:** Enable SpeechRecognition and audio summary briefings.

### Stage 5: Polish & Ecosystem (Priority: P3/P4)
- [ ] **Task 5.1:** Sync version numbers across `package.json`, `wxt.config.ts`, and README.
- [ ] **Task 5.2:** Add Pyodide WebAssembly Python runtime to Coding Space.
- [ ] **Task 5.3:** Submit package for Chrome Web Store review.

---

## 7. Deliverable Documentation Index

Detailed audit documentation has been generated in the project documentation directory:
1. **[`docs/audit/AUDIT_COVERAGE.md`](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/AUDIT_COVERAGE.md):** Complete 95-file repository inventory, line counts, sizes, inspection statuses, and test logs.
2. **[`docs/audit/FINDINGS_REGISTER.md`](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/FINDINGS_REGISTER.md):** Severity-based register detailing 27 findings (P0–P4) with evidence, root causes, mitigations, and regression test cases.
3. **[`docs/audit/RESEARCH_AND_FEATURE_ROADMAP.md`](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/RESEARCH_AND_FEATURE_ROADMAP.md):** External research findings, citations, competitive matrix, and a prioritized 5-category feature roadmap.
4. **[`docs/audit/TARGET_ARCHITECTURE.md`](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/TARGET_ARCHITECTURE.md):** Architectural blueprints, Mermaid diagrams, subsystem designs, and a zero-downtime migration strategy.
5. **[`docs/audit/PROJECT_AUDIT_REPORT.md`](file:///c:/Users/maham/Desktop/NIM_AGENT-1.1.0/docs/audit/PROJECT_AUDIT_REPORT.md):** Master audit report and executive summary.
