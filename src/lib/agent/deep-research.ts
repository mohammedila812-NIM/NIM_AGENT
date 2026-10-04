/**
 * Timed Deep Research Engine for NIM Agent
 * Autonomously crawls multiple web sources, extracts structured intelligence,
 * and streams simultaneous live notes into the NIM Virtual Workspace until
 * the user-specified deadline expires.
 */

import { vfs } from '../workspace/vfs';
import { webSearch } from './tools/web-search';
import { chatCompletion } from '../llm/client';
import type { ProviderConfig } from '../llm/types';
import type { DiscoveredModel } from '../llm/model-registry';

export interface DeepResearchConfig {
  topic: string;
  durationMinutes: number;
  providerConfig: ProviderConfig;
  model: DiscoveredModel;
  searchConfig?: {
    provider: 'brave' | 'serper' | 'duckduckgo';
    apiKey?: string;
  };
}

export interface DeepResearchSource {
  url: string;
  title: string;
  snippet: string;
  timestamp: number;
  extractedFactsCount: number;
}

export interface DeepResearchProgress {
  status: 'idle' | 'planning' | 'crawling' | 'extracting' | 'synthesizing' | 'completed' | 'stopped' | 'error';
  remainingSeconds: number;
  totalSeconds: number;
  pagesVisited: number;
  notesRecorded: number;
  currentUrl?: string;
  currentAction?: string;
  activeFilePath?: string;
  finalReportPath?: string;
  error?: string;
}

export type DeepResearchCallback = (progress: DeepResearchProgress) => void;

function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'research';
}

export class TimedDeepResearchSession {
  private config: DeepResearchConfig;
  private isAborted = false;
  private isPaused = false;
  private sources: DeepResearchSource[] = [];
  private visitedUrls = new Set<string>();
  private urlQueue: Array<{ url: string; title: string; snippet: string }> = [];
  private researchFolder: string;
  private liveNotesPath: string;
  private reportPath: string;
  private callback?: DeepResearchCallback;
  private timerInterval?: ReturnType<typeof setInterval>;
  private deadline: number = 0;
  private totalSeconds: number = 0;
  private notesCount = 0;

  constructor(config: DeepResearchConfig, callback?: DeepResearchCallback) {
    this.config = config;
    this.callback = callback;
    const folderSlug = `${sanitizeFolderName(config.topic)}-${new Date().toISOString().slice(0, 10)}`;
    this.researchFolder = `/research/${folderSlug}`;
    this.liveNotesPath = `${this.researchFolder}/live_notes.md`;
    this.reportPath = `${this.researchFolder}/EXECUTIVE_REPORT.md`;
    this.totalSeconds = Math.max(1, Math.round(config.durationMinutes * 60));
  }

  public stop(): void {
    this.isAborted = true;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.notifyProgress({
      status: 'stopped',
      currentAction: 'Research stopped by user.',
    });
  }

  private notifyProgress(partial: Partial<DeepResearchProgress>): void {
    const remaining = Math.max(0, Math.round((this.deadline - Date.now()) / 1000));
    this.callback?.({
      status: 'crawling',
      remainingSeconds: remaining,
      totalSeconds: this.totalSeconds,
      pagesVisited: this.visitedUrls.size,
      notesRecorded: this.notesCount,
      activeFilePath: this.liveNotesPath,
      finalReportPath: this.reportPath,
      ...partial,
    });
  }

  /** Run the autonomous timed deep research loop */
  public async start(): Promise<string> {
    await vfs.init();
    await vfs.ensureFolder(this.researchFolder);

    const startTime = Date.now();
    this.deadline = startTime + this.totalSeconds * 1000;

    // Initialize the live notes file
    const initialHeader = `# Deep Research Dossier: ${this.config.topic}
*Initiated: ${new Date().toLocaleString()} | Duration: ${this.config.durationMinutes} minutes*
*Model: ${this.config.model.id}*

---

## 🔴 Live Field Notes (Auto-Streaming)
`;
    await vfs.writeFile(this.liveNotesPath, initialHeader, {
      createdBy: 'agent',
      tags: ['research', 'deep-research', sanitizeFolderName(this.config.topic)],
      metadata: { topic: this.config.topic, startTime, durationMinutes: this.config.durationMinutes },
      overwrite: true,
    });

    this.notifyProgress({
      status: 'planning',
      currentAction: 'Decomposing research objective and generating exploratory queries...',
    });

    // Start background countdown ticker
    this.timerInterval = setInterval(() => {
      if (Date.now() >= this.deadline) {
        if (this.timerInterval) clearInterval(this.timerInterval);
      } else {
        this.notifyProgress({});
      }
    }, 1000);

    try {
      // 1. Generate Sub-Queries
      const subQueries = await this.generateSubQueries(this.config.topic);
      let queryIndex = 0;

      // 2. Unstoppable Crawling Loop
      while (Date.now() < this.deadline && !this.isAborted) {
        // If queue is low, run next search query
        if (this.urlQueue.length < 2) {
          const currentQuery =
            queryIndex < subQueries.length ? subQueries[queryIndex++] : `${this.config.topic} recent analysis ${queryIndex}`;

          this.notifyProgress({
            status: 'planning',
            currentAction: `Searching web: "${currentQuery}"`,
          });

          const searchRes = await webSearch(currentQuery, this.config.searchConfig);
          const urls = this.parseSearchResults(searchRes);
          for (const u of urls) {
            if (!this.visitedUrls.has(u.url)) {
              this.urlQueue.push(u);
            }
          }
        }

        // Pop next URL to explore
        const nextTarget = this.urlQueue.shift();
        if (!nextTarget) {
          // Wait briefly before retrying
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        this.visitedUrls.add(nextTarget.url);
        this.notifyProgress({
          status: 'crawling',
          currentUrl: nextTarget.url,
          currentAction: `Crawling & reading: ${nextTarget.title || nextTarget.url}`,
        });

        // Fetch page content
        const pageText = await this.fetchPageText(nextTarget.url, nextTarget.snippet);

        if (this.isAborted || Date.now() >= this.deadline) break;

        // Extract key findings
        this.notifyProgress({
          status: 'extracting',
          currentUrl: nextTarget.url,
          currentAction: `Extracting insights from: ${nextTarget.title}`,
        });

        const findings = await this.extractFindings(nextTarget.title, nextTarget.url, pageText);

        if (findings && findings.trim().length > 20) {
          this.notesCount++;
          const noteEntry = `
### 🌐 [${nextTarget.title || 'Source'}](${nextTarget.url})
*Crawled at: ${new Date().toLocaleTimeString()}*

${findings.trim()}

---
`;
          // Simultaneous live write to Virtual Workspace!
          await vfs.appendFile(this.liveNotesPath, noteEntry, { createdBy: 'agent' });

          this.sources.push({
            url: nextTarget.url,
            title: nextTarget.title,
            snippet: nextTarget.snippet,
            timestamp: Date.now(),
            extractedFactsCount: 1,
          });

          this.notifyProgress({
            currentAction: `Appended findings to ${this.liveNotesPath}`,
          });
        }

        // Small breathing delay to prevent rate limits
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      // 3. Time's Up! Trigger Final Synthesis Pass
      if (this.timerInterval) clearInterval(this.timerInterval);

      this.notifyProgress({
        status: 'synthesizing',
        currentAction: '⏰ Time expired! Generating comprehensive Executive Dossier from all collected notes...',
      });

      const finalReport = await this.generateExecutiveReport();
      await vfs.writeFile(this.reportPath, finalReport, {
        createdBy: 'agent',
        tags: ['report', 'dossier', 'executive-summary', sanitizeFolderName(this.config.topic)],
        metadata: {
          topic: this.config.topic,
          pagesCrawled: this.visitedUrls.size,
          notesCount: this.notesCount,
          completedAt: Date.now(),
        },
        overwrite: true,
      });

      // Save sources catalog
      await vfs.writeFile(
        `${this.researchFolder}/sources_catalog.json`,
        JSON.stringify(this.sources, null, 2),
        { createdBy: 'agent' }
      );

      this.notifyProgress({
        status: 'completed',
        remainingSeconds: 0,
        currentAction: `Research complete! Report saved to ${this.reportPath}`,
      });

      // Browser notification
      if (typeof chrome !== 'undefined' && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '/icon/128.png',
          title: 'Deep Research Complete!',
          message: `NIM Agent finished researching "${this.config.topic}". Report is ready in your Workspace.`,
        });
      }

      return finalReport;
    } catch (err: unknown) {
      if (this.timerInterval) clearInterval(this.timerInterval);
      const msg = err instanceof Error ? err.message : String(err);
      this.notifyProgress({
        status: 'error',
        error: msg,
        currentAction: `Research failed: ${msg}`,
      });
      throw err;
    }
  }

  /** Ask LLM to generate exploratory sub-queries */
  private async generateSubQueries(topic: string): Promise<string[]> {
    try {
      const res = await chatCompletion(this.config.providerConfig, {
        model: this.config.model.id,
        messages: [
          {
            role: 'system',
            content: 'You are a research query strategist. Generate 5 distinct, high-impact search queries to deeply investigate a topic from foundational concepts, recent breakthroughs, technical metrics, to market landscape. Reply with ONLY the 5 search queries, one per line, no numbers or bullet points.',
          },
          { role: 'user', content: `Topic: ${topic}` },
        ],
        temperature: 0.2,
      });

      const lines = (res.choices[0]?.message?.content || '')
        .split('\n')
        .map((l) => l.replace(/^[\d.-]+\s*/, '').trim())
        .filter((l) => l.length > 5);

      return lines.length > 0 ? lines : [topic, `${topic} analysis`, `${topic} benchmarks`];
    } catch {
      return [topic, `${topic} news 2026`, `${topic} overview`];
    }
  }

  /** Parse search results string into structured targets */
  private parseSearchResults(rawText: string): Array<{ url: string; title: string; snippet: string }> {
    const results: Array<{ url: string; title: string; snippet: string }> = [];
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    const lines = rawText.split('\n');

    let currentTitle = '';
    let currentUrl = '';
    let currentSnippet = '';

    for (const line of lines) {
      const match = urlRegex.exec(line);
      if (match) {
        currentUrl = match[1].replace(/[.,;]$/, '');
        currentTitle = line.replace(match[0], '').replace(/^[\d.-]+\s*/, '').trim() || 'Web Result';
        results.push({
          url: currentUrl,
          title: currentTitle,
          snippet: currentSnippet || currentTitle,
        });
        currentSnippet = '';
      } else if (line.trim().length > 10) {
        currentSnippet += ' ' + line.trim();
      }
    }

    return results;
  }

  /** Fetch page text or fallback to search snippet */
  private async fetchPageText(url: string, fallbackSnippet: string): Promise<string> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      const html = await res.text();

      // Clean HTML to text
      const clean = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return clean.slice(0, 6000);
    } catch {
      return fallbackSnippet || 'Snippet unavailable';
    }
  }

  /** Extract key facts from page text */
  private async extractFindings(title: string, url: string, content: string): Promise<string> {
    const prompt = `You are an elite research analyst. Extract the most valuable facts, specific statistics, technical breakthroughs, dates, and conclusions regarding "${this.config.topic}" from the following source text.
Source Title: ${title}
Source URL: ${url}

Content:
${content.slice(0, 4000)}

Guidelines:
- Highlight verified claims, benchmarks, numbers, and dates.
- Avoid vague introductory fluff.
- Use bullet points with bold keywords.`;

    const res = await chatCompletion(this.config.providerConfig, {
      model: this.config.model.id,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 500,
    });

    return res.choices[0]?.message?.content || '';
  }

  /** Generate final executive synthesis report */
  private async generateExecutiveReport(): Promise<string> {
    const liveNotesFile = await vfs.readFile(this.liveNotesPath);
    const notesContent = liveNotesFile?.content || 'No notes collected.';

    const prompt = `You are a Principal Intelligence Analyst. Synthesize the following accumulated field notes into a publication-grade Executive Dossier on "${this.config.topic}".

Accumulated Research Notes:
${notesContent.slice(0, 15000)}

Generate the report in GitHub-flavored Markdown with the following structure:
# 📑 Executive Dossier: ${this.config.topic}
## 1. Executive Summary (Key Takeaways & Core Verdict)
## 2. Comparative Matrix / Data Highlights (Markdown Table)
## 3. Deep-Dive Findings & Technical Breakthroughs
## 4. Industry Impact & Future Outlook
## 5. Verified Citation Index (List all sources consulted with URLs)`;

    const res = await chatCompletion(this.config.providerConfig, {
      model: this.config.model.id,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2500,
    });

    return res.choices[0]?.message?.content || '# Executive Dossier\n\nResearch concluded.';
  }
}
