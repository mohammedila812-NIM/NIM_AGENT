document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // 2. Intersection Observer for Scroll Reveals
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal-ready').forEach((el) => {
    revealObserver.observe(el);
  });

  // 3. Mobile Navigation Drawer Toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileDrawer = document.getElementById('mobileDrawer');
  if (mobileMenuBtn && mobileDrawer) {
    mobileMenuBtn.addEventListener('click', () => {
      mobileDrawer.classList.toggle('open');
      const isOpen = mobileDrawer.classList.contains('open');
      mobileMenuBtn.innerHTML = isOpen 
        ? '<i data-lucide="x" style="width: 22px; height: 22px;"></i>' 
        : '<i data-lucide="menu" style="width: 22px; height: 22px;"></i>';
      if (window.lucide) window.lucide.createIcons();
    });

    document.querySelectorAll('.mobile-drawer-link').forEach((link) => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('open');
        mobileMenuBtn.innerHTML = '<i data-lucide="menu" style="width: 22px; height: 22px;"></i>';
        if (window.lucide) window.lucide.createIcons();
      });
    });
  }

  // 4. Live Simulator (Browser Agent + DevTools CDP Dual Mode)
  let simMode = 'browser'; // 'browser' or 'devtools'
  let simRunning = true;
  let simStep = 0;

  const browserEvents = [
    { tag: 'Navigation', target: 'ArXiv & Tech Docs', detail: 'Grounded DOM traversal across multi-tab sources' },
    { tag: 'Extraction', target: 'Structured Data AST', detail: 'Synthesized citations & extracted clean tabular dataset' },
    { tag: 'Sentinel', target: 'Zero-Token Watcher', detail: 'Anchored change-detector baseline for layout mutations' }
  ];

  const devtoolsEvents = [
    { tag: 'DevTools CDP', target: 'Live DOM & CSS Stylesheet', detail: 'T2 write: applied flexbox refactor with visual diff HITL' },
    { tag: 'Delegation', target: 'DeepSeek R1 Specialist', detail: 'Sub-agent dispatched to fix hydration mismatch with tab lock' },
    { tag: 'Rollback', target: 'CDP Mutation Snapshots', detail: 'SHA-256 bound rollback point saved to extension storage' }
  ];

  const simGoalEl = document.getElementById('simGoalText');
  const simTraceListEl = document.getElementById('simTraceList');
  const simToggleBtn = document.getElementById('simToggleBtn');
  const tabBrowserBtn = document.getElementById('tabBrowserBtn');
  const tabDevToolsBtn = document.getElementById('tabDevToolsBtn');
  const simBadgeModeEl = document.getElementById('simBadgeMode');
  const simStatusEl = document.getElementById('simStatusText');
  const simLeftScreenEl = document.getElementById('simLeftScreen');

  function renderSimEvents() {
    const currentEvents = simMode === 'browser' ? browserEvents : devtoolsEvents;
    if (!simTraceListEl) return;

    simTraceListEl.innerHTML = currentEvents.map((ev, i) => {
      const isActive = simStep === i && simRunning;
      const isPast = i < simStep && simRunning;
      const borderClass = isActive ? 'border-color: #df6b48; color: #f1a186;' : isPast ? 'border-color: #7ea99c; color: #c9d8cf;' : 'border-color: #405469; color: #738596;';
      const statusText = isActive ? ev.detail : isPast ? 'Completed' : 'Queued';

      return `
        <div style="position: relative; border-left: 2px solid; padding-left: 12px; margin-bottom: 14px; transition: all 0.4s ease; ${borderClass}">
          <div style="font-family: var(--font-terminal); font-size: 8px; text-transform: uppercase; letter-spacing: 0.13em;">${ev.tag}</div>
          <div style="margin-top: 2px; font-size: 11px; color: #d7e0d8; font-weight: 600;">${ev.target}</div>
          <div style="margin-top: 2px; font-size: 9px; color: #78908d;">${statusText}</div>
        </div>
      `;
    }).join('');
  }

  function updateSimUI() {
    if (simMode === 'browser') {
      if (simBadgeModeEl) simBadgeModeEl.textContent = 'BROWSER EXTENSION (MV3)';
      if (simGoalEl) simGoalEl.textContent = 'Find primary sources on local-first AI, extract structured data, and build a research brief.';
      if (simLeftScreenEl) {
        simLeftScreenEl.innerHTML = `
          <div class="nim-scan" style="position: absolute; left: 0; right: 0; top: 0; height: 60px; background: linear-gradient(to bottom, transparent, rgba(158, 197, 183, 0.4), transparent);"></div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #c8d1c9; padding-bottom: 10px; margin-bottom: 20px;">
            <span style="font-family: var(--font-terminal); font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: #5d726e;">Web Surface / DOM Inspector</span>
            <span style="display: flex; align-items: center; gap: 6px; font-size: 10px; color: #71948b;">
              <span class="nim-pulse" style="width: 8px; height: 8px; border-radius: 50%; background: #71948b; display: inline-block;"></span>
              ${simRunning ? 'Agent Active' : 'Session Paused'}
            </span>
          </div>
          <div style="max-width: 350px;">
            <div style="height: 8px; width: 60px; background: #c6d3cc; border-radius: 4px; margin-bottom: 12px;"></div>
            <div style="height: 24px; width: 90%; background: rgba(27, 48, 65, 0.9); border-radius: 4px; margin-bottom: 8px;"></div>
            <div style="height: 24px; width: 65%; background: rgba(27, 48, 65, 0.9); border-radius: 4px; margin-bottom: 16px;"></div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="height: 6px; width: 80%; background: #c3d0c9; border-radius: 3px;"></div>
              <div style="height: 6px; width: 65%; background: #c3d0c9; border-radius: 3px;"></div>
              <div style="height: 6px; width: 90%; background: #c3d0c9; border-radius: 3px;"></div>
            </div>
          </div>
          <div style="position: absolute; bottom: 16px; left: 16px; display: inline-flex; align-items: center; gap: 6px; background: #edf3ed; border: 1px solid #b9cfc4; padding: 4px 10px; border-radius: 999px;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: #719f91;"></span>
            <span style="font-family: var(--font-terminal); font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #5c756e;">DOM Tree Grounded (Numeric IDs)</span>
          </div>
        `;
      }
    } else {
      if (simBadgeModeEl) simBadgeModeEl.textContent = 'DEVTOOLS PROTOCOL (CDP T2)';
      if (simGoalEl) simGoalEl.textContent = 'Inspect element CSS, patch navigation layout, and delegate script debugging to DeepSeek R1.';
      if (simLeftScreenEl) {
        simLeftScreenEl.innerHTML = `
          <div class="nim-scan" style="position: absolute; left: 0; right: 0; top: 0; height: 60px; background: linear-gradient(to bottom, transparent, rgba(223, 107, 72, 0.3), transparent);"></div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #c8d1c9; padding-bottom: 10px; margin-bottom: 20px;">
            <span style="font-family: var(--font-terminal); font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: #5d726e;">CDP Chokepoint / Policy Tier T2</span>
            <span style="display: flex; align-items: center; gap: 6px; font-size: 10px; color: #df6b48;">
              <span class="nim-pulse" style="width: 8px; height: 8px; border-radius: 50%; background: #df6b48; display: inline-block;"></span>
              ${simRunning ? 'Specialist Attached' : 'Debugger Idle'}
            </span>
          </div>
          <div style="background: #10203a; color: #f4f2ec; border-radius: 8px; padding: 14px; font-family: var(--font-terminal); font-size: 10px; line-height: 1.6; margin-bottom: 14px;">
            <div style="color: #62877e;">$ cdp.DOM.setStyleTexts --rule ".nav-brand"</div>
            <div style="color: #df6b48; margin-top: 4px;">⚡ HITL Gate: T2 write approved (Hash: e8f2...b109)</div>
            <div style="color: #a8c8c1; margin-top: 2px;">⚡ Specialist: DeepSeek R1 analyzing V8 stack trace</div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div style="height: 56px; border-radius: 8px; border: 1px solid #cad4cd; background: #e9eee8; padding: 8px; font-size: 9px; color: #536071;">
              <strong>DOM Mutations</strong><br/>2 elements styled
            </div>
            <div style="height: 56px; border-radius: 8px; border: 1px solid #cad4cd; background: #e9eee8; padding: 8px; font-size: 9px; color: #536071;">
              <strong>Audit Log</strong><br/>Rate limit: 12/60 req
            </div>
          </div>
          <div style="position: absolute; bottom: 16px; left: 16px; display: inline-flex; align-items: center; gap: 6px; background: #edf3ed; border: 1px solid #b9cfc4; padding: 4px 10px; border-radius: 999px;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: #df6b48;"></span>
            <span style="font-family: var(--font-terminal); font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #5c756e;">Single-Writer Tab Lock Engaged</span>
          </div>
        `;
      }
    }
    renderSimEvents();
  }

  if (tabBrowserBtn && tabDevToolsBtn) {
    tabBrowserBtn.addEventListener('click', () => {
      simMode = 'browser';
      tabBrowserBtn.classList.add('active');
      tabBrowserBtn.setAttribute('aria-pressed', 'true');
      tabDevToolsBtn.classList.remove('active');
      tabDevToolsBtn.setAttribute('aria-pressed', 'false');
      simStep = 0;
      updateSimUI();
    });

    tabDevToolsBtn.addEventListener('click', () => {
      simMode = 'devtools';
      tabDevToolsBtn.classList.add('active');
      tabDevToolsBtn.setAttribute('aria-pressed', 'true');
      tabBrowserBtn.classList.remove('active');
      tabBrowserBtn.setAttribute('aria-pressed', 'false');
      simStep = 0;
      updateSimUI();
    });
  }

  if (simToggleBtn) {
    simToggleBtn.addEventListener('click', () => {
      simRunning = !simRunning;
      simToggleBtn.innerHTML = simRunning 
        ? '<i data-lucide="pause" style="width: 13px; height: 13px;"></i>' 
        : '<i data-lucide="play" style="width: 13px; height: 13px;"></i>';
      if (window.lucide) window.lucide.createIcons();
      updateSimUI();
    });
  }

  // Periodic sim ticker
  setInterval(() => {
    if (!simRunning) return;
    simStep = (simStep + 1) % 3;
    renderSimEvents();
  }, 2400);

  updateSimUI();

  // 5. Capability Matrix Switcher
  const capabilities = [
    {
      id: 'devtools',
      index: '01',
      label: 'Security-First DevTools (CDP) Engine',
      icon: 'wrench',
      color: '#df6b48',
      title: 'Direct Chrome DevTools Protocol Control',
      body: 'Single chokepoint gateway with strict capability tiers (T0-T3). Live DOM/CSS editing, V8 script live-reloading, network interception, and TOCTOU cryptographic payload-hash binding with automated undo snapshots.',
      steps: [
        'Capability Tiers: T0 Read-only to T2 Writes & T3 Exec',
        'Cryptographic TOCTOU Payload-Hash Binding & HITL Diffs',
        'Fail-closed domain blocklist and automated rollback snapshots'
      ]
    },
    {
      id: 'specialists',
      index: '02',
      label: 'Specialist Sub-Agent Delegation',
      icon: 'bot',
      color: '#d9ab58',
      title: 'Async Multi-Model Sub-Agent Delegation',
      body: 'The primary agent delegates heavy coding, live debugging, or deep analysis to dedicated specialist models (DeepSeek R1, Claude 3.5 Sonnet, Llama 3.3 70B) with tab mutating locks while continuing its own orchestrations.',
      steps: [
        'Scoped tool allowlists & single-writer tab locks',
        'Async background execution with non-blocking progress',
        'Automatic recovery after service worker restarts'
      ]
    },
    {
      id: 'vfs',
      index: '03',
      label: 'Virtual File System & Export Hub',
      icon: 'folder-archive',
      color: '#62877e',
      title: 'In-Memory VFS, Gist & ZIP Workspace',
      body: 'Autonomous virtual file system completely inside browser memory. Scrape, compile, format, and package multi-file projects into clean downloadable ZIP archives or publish directly as GitHub Gists.',
      steps: [
        'Virtual in-memory workspace isolation',
        'Multi-tab asset extraction & bundling',
        'Instant client-side ZIP packaging and Gist export'
      ]
    },
    {
      id: 'browser',
      index: '04',
      label: 'Autonomous Web Research & Scraping',
      icon: 'search',
      color: '#8fb7ab',
      title: 'Research the Open Web Across Tabs',
      body: 'Traces sources across tabs, parses complex DOM trees, extracts structured tabular data, and grounds evidence with precise citations—not guesswork.',
      steps: [
        'Scan active DOM & cluster primary evidence',
        'Extract tabular data and clean records',
        'Cross-verify findings across multiple sources'
      ]
    },
    {
      id: 'sentinel',
      index: '05',
      label: 'Zero-Token Sentinel Watcher',
      icon: 'shield-alert',
      color: '#71948b',
      title: 'Background Page Change Detection',
      body: 'Monitors DOM mutations, price updates, and layout shifts completely in the content script with zero LLM token consumption until actual change thresholds are met.',
      steps: [
        'Zero LLM tokens during idle monitoring',
        'TOCTOU baseline re-anchoring & debounce gates',
        'Automatic or Human-In-The-Loop alerting'
      ]
    },
    {
      id: 'safety',
      index: '06',
      label: 'Instant ESC Kill-Switch & Rollback',
      icon: 'shield-check',
      color: '#df6b48',
      title: 'Power With an Instant Handbrake',
      body: 'Hit ESC at any point to sever the LLM stream, abort tool actions, and halt execution. All DOM, CSS, and script mutations are snapshotted for instant atomic rollback.',
      steps: [
        'Global ESC key interruption halts active agent stream',
        'Policy tiers block unauthorized scripts & writes',
        'Rollback Engine enables single-command mutation undo'
      ]
    }
  ];

  let selectedCapIndex = 0;
  const capListEl = document.getElementById('capabilityList');
  const capDisplayCardEl = document.getElementById('capabilityDisplayCard');

  function renderCapabilities() {
    if (!capListEl || !capDisplayCardEl) return;

    capListEl.innerHTML = capabilities.map((item, i) => {
      const activeClass = selectedCapIndex === i ? 'active' : '';
      return `
        <button class="capability-item-btn ${activeClass}" data-index="${i}">
          <span style="display: flex; align-items: center; gap: 16px;">
            <span class="icon-box">
              <i data-lucide="${item.icon}" style="width: 16px; height: 16px;"></i>
            </span>
            <span>
              <span class="mono" style="font-size: 9px; color: #7e948f; margin-right: 8px;">${item.index}</span>
              <span style="font-size: 15px; font-weight: 600;">${item.label}</span>
            </span>
          </span>
          <i data-lucide="arrow-right" style="width: 16px; height: 16px; ${selectedCapIndex === i ? 'color: #df6b48;' : 'opacity: 0;'}"></i>
        </button>
      `;
    }).join('');

    const cap = capabilities[selectedCapIndex];
    capDisplayCardEl.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <span class="mono" style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: #7eaaa0;">Capability / ${cap.index}</span>
          <span style="font-size: 10px; color: #8ba9a3; border: 1px solid #486371; padding: 3px 8px; border-radius: 999px;">Live Subsystem</span>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 20px;">
          <div style="width: 54px; height: 54px; border-radius: 12px; background: ${cap.color}; color: #10203a; display: grid; place-items: center; flex-shrink: 0;">
            <i data-lucide="${cap.icon}" style="width: 26px; height: 26px;"></i>
          </div>
          <div>
            <h3 style="font-size: 24px; font-weight: 700; letter-spacing: -0.04em;">${cap.title}</h3>
            <p style="margin-top: 10px; color: #aebec0; font-size: 15px; line-height: 1.6; max-width: 480px;">${cap.body}</p>
          </div>
        </div>
      </div>
      <div style="margin-top: 36px; border-top: 1px solid #40576b; padding-top: 20px;">
        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #88a19f; font-family: var(--font-terminal); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 12px;">
          <span>Subsystem Trace</span>
          <span style="color: #a8c8c1; display: flex; align-items: center; gap: 6px;">
            <span class="nim-pulse" style="width: 6px; height: 6px; border-radius: 50%; background: #a8c8c1; display: inline-block;"></span> Ready
          </span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${cap.steps.map((st, i) => `
            <div style="display: flex; align-items: center; gap: 12px; background: #20394e; padding: 10px 14px; border-radius: 8px; font-size: 12px; color: #c8d7d1;">
              <span class="mono" style="font-size: 9px; color: #739b91;">0${i + 1}</span>
              <span>${st}</span>
              <i data-lucide="check" style="width: 14px; height: 14px; margin-left: auto; color: #a8c8c1;"></i>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    // Attach click handlers
    document.querySelectorAll('.capability-item-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedCapIndex = parseInt(btn.dataset.index, 10);
        renderCapabilities();
      });
    });
  }

  renderCapabilities();

  // 6. Providers Selection Switcher
  const providersData = [
    { name: 'DeepSeek (R1 / V3)', defaultTag: 'SPECIALIST REASONER', model: 'deepseek-ai/deepseek-r1', desc: 'State-of-the-art chain-of-thought reasoning for complex specialist coding, debugging, and analysis.' },
    { name: 'Anthropic Claude', defaultTag: 'FRONTIER CODER', model: 'claude-3-5-sonnet-20241022', desc: 'Superior programming acumen, live stylesheet refactoring, and structured HTML AST synthesis.' },
    { name: 'NVIDIA NIM (Cloud)', defaultTag: 'FLAGSHIP NIM', model: 'meta/llama-3.3-70b-instruct', desc: 'High-speed cloud inference with dedicated vision models grounding UI coordinates, screenshot diffs, and layouts.' },
    { name: 'Google AI Studio (Gemini)', defaultTag: 'HIGH CAPACITY', model: 'gemini-2.0-flash', desc: 'Massive context window, ultra-fast latency, and automated 35s rate-limit cooldown recovery.' },
    { name: 'OpenAI Compatible', defaultTag: 'UNIVERSAL', model: 'gpt-4o / gpt-4o-mini', desc: 'Standard OpenAI completion endpoint compatible with corporate and private vLLM endpoints.' },
    { name: 'Groq (Ultra-Fast)', defaultTag: 'LPUS ACCELERATED', model: 'llama-3.3-70b-versatile', desc: 'Instantaneous token throughput for real-time intent classification and routing.' },
    { name: 'Ollama (Local Private)', defaultTag: '100% OFFLINE', model: 'llama3.2 / deepseek-r1:8b', desc: 'Zero cloud telemetry. Private execution directly on your local GPU with no internet transmission.' }
  ];

  let selectedProvider = providersData[0];
  const providerListEl = document.getElementById('providerList');
  const providerCardEl = document.getElementById('providerCard');

  function renderProviders() {
    if (!providerListEl || !providerCardEl) return;

    providerListEl.innerHTML = providersData.map((p, i) => {
      const isSelected = selectedProvider.name === p.name;
      return `
        <button class="provider-btn ${isSelected ? 'active' : ''}" data-idx="${i}">
          <span style="display: flex; align-items: center; gap: 12px;">
            <span class="mono" style="font-size: 10px; color: #83918b;">0${i + 1}</span>
            <span>${p.name}</span>
          </span>
          ${isSelected ? '<i data-lucide="check" style="width: 16px; height: 16px; color: var(--accent-teal);"></i>' : ''}
        </button>
      `;
    }).join('');

    providerCardEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div class="mono" style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: #a8c8c1;">Configured Provider</div>
          <h3 style="font-size: 28px; font-weight: 700; margin-top: 8px; letter-spacing: -0.04em;">${selectedProvider.name}</h3>
        </div>
        <span style="font-family: var(--font-terminal); font-size: 9px; background: rgba(168, 200, 193, 0.2); color: #a8c8c1; border: 1px solid #a8c8c1; padding: 4px 10px; border-radius: 999px;">${selectedProvider.defaultTag}</span>
      </div>
      <div style="margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div style="background: #172d42; border: 1px solid #3b5366; border-radius: 10px; padding: 16px;">
          <div class="mono" style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; color: #87a29a;">Active Model</div>
          <div style="margin-top: 6px; font-size: 13px; font-weight: 600; color: #f4f2ec; word-break: break-all;">${selectedProvider.model}</div>
        </div>
        <div style="background: #172d42; border: 1px solid #3b5366; border-radius: 10px; padding: 16px;">
          <div class="mono" style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; color: #87a29a;">Credential Storage</div>
          <div style="margin-top: 6px; font-size: 13px; font-weight: 600; color: #a8c8c1; display: flex; align-items: center; gap: 6px;">
            <i data-lucide="lock" style="width: 14px; height: 14px;"></i> Encrypted chrome.storage
          </div>
        </div>
      </div>
      <p style="margin-top: 24px; color: #aebfc0; font-size: 14px; line-height: 1.6;">${selectedProvider.desc}</p>
    `;

    if (window.lucide) window.lucide.createIcons();

    document.querySelectorAll('.provider-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        selectedProvider = providersData[idx];
        renderProviders();
      });
    });
  }

  renderProviders();

  // 7. Toast Notification Handler
  window.showToast = function(message) {
    const existing = document.getElementById('toastNotice');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toastNotice';
    toast.className = 'toast-notice';
    toast.innerHTML = `
      <i data-lucide="check-circle" style="width: 18px; height: 18px; color: #a8c8c1; flex-shrink: 0;"></i>
      <span>${message}</span>
      <button onclick="this.parentElement.remove()" style="background: none; border: none; color: #9cb0b0; cursor: pointer; padding: 4px; margin-left: 8px;">
        <i data-lucide="x" style="width: 15px; height: 15px;"></i>
      </button>
    `;
    document.body.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4500);
  };
});
