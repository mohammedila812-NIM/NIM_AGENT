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

  // 4. Live Simulator (Desktop OS + Browser Dual Mode)
  let simMode = 'desktop'; // 'desktop' or 'browser'
  let simRunning = true;
  let simStep = 0;

  const desktopEvents = [
    { tag: 'Actuation', target: 'VS Code & Terminal', detail: 'Arranging workspace layout & launching dev servers' },
    { tag: 'Inspection', target: 'Chrome & Outlook', detail: 'Extracting invoice attachments & calculating totals' },
    { tag: 'Scheduler', target: 'Cron Engine', detail: 'Queued weekly financial sync every Monday 9:00 AM' }
  ];

  const browserEvents = [
    { tag: 'Reading', target: 'openai.com/research', detail: 'Scanning page structure & citations' },
    { tag: 'Finding', target: 'arxiv.org/abs/2406.09123', detail: 'Grounding primary multimodal findings' },
    { tag: 'Extracting', target: 'notion.so/briefing', detail: 'Formatting structured markdown summary' }
  ];

  const simGoalEl = document.getElementById('simGoalText');
  const simTraceListEl = document.getElementById('simTraceList');
  const simToggleBtn = document.getElementById('simToggleBtn');
  const tabDesktopBtn = document.getElementById('tabDesktopBtn');
  const tabBrowserBtn = document.getElementById('tabBrowserBtn');
  const simBadgeModeEl = document.getElementById('simBadgeMode');
  const simStatusEl = document.getElementById('simStatusText');
  const simLeftScreenEl = document.getElementById('simLeftScreen');

  function renderSimEvents() {
    const currentEvents = simMode === 'desktop' ? desktopEvents : browserEvents;
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
    if (simMode === 'desktop') {
      if (simBadgeModeEl) simBadgeModeEl.textContent = 'DESKTOP OS + DUAL VISION';
      if (simGoalEl) simGoalEl.textContent = 'Organize dev workspace, extract invoices from Outlook, and schedule weekly brief.';
      if (simLeftScreenEl) {
        simLeftScreenEl.innerHTML = `
          <div class="nim-scan" style="position: absolute; left: 0; right: 0; top: 0; height: 60px; background: linear-gradient(to bottom, transparent, rgba(158, 197, 183, 0.4), transparent);"></div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #c8d1c9; padding-bottom: 10px; margin-bottom: 20px;">
            <span style="font-family: var(--font-terminal); font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: #5d726e;">OS Surface / Win32 UIA + Vision</span>
            <span style="display: flex; align-items: center; gap: 6px; font-size: 10px; color: #71948b;">
              <span class="nim-pulse" style="width: 8px; height: 8px; border-radius: 50%; background: #71948b; display: inline-block;"></span>
              ${simRunning ? 'Agent Active' : 'Session Paused'}
            </span>
          </div>
          <div style="background: #10203a; color: #f4f2ec; border-radius: 8px; padding: 14px; font-family: var(--font-terminal); font-size: 10px; line-height: 1.6; margin-bottom: 14px;">
            <div style="color: #62877e;">$ jarvis --workspace "dev_mode" --email-sync</div>
            <div style="color: #df6b48; margin-top: 4px;">⚡ Actuation: SetForegroundWindow (VS Code)</div>
            <div style="color: #a8c8c1; margin-top: 2px;">⚡ Scheduler: Scheduled Friday 17:00 status sync</div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div style="height: 56px; border-radius: 8px; border: 1px solid #cad4cd; background: #e9eee8; padding: 8px; font-size: 9px; color: #536071;">
              <strong>Outlook Client</strong><br/>3 invoices analyzed
            </div>
            <div style="height: 56px; border-radius: 8px; border: 1px solid #cad4cd; background: #e9eee8; padding: 8px; font-size: 9px; color: #536071;">
              <strong>Process Monitor</strong><br/>CPU: 3% | RAM: Safe
            </div>
          </div>
          <div style="position: absolute; bottom: 16px; left: 16px; display: inline-flex; align-items: center; gap: 6px; background: #edf3ed; border: 1px solid #b9cfc4; padding: 4px 10px; border-radius: 999px;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: #719f91;"></span>
            <span style="font-family: var(--font-terminal); font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #5c756e;">UIA Accessibility + Gemini Brain</span>
          </div>
        `;
      }
    } else {
      if (simBadgeModeEl) simBadgeModeEl.textContent = 'BROWSER EXTENSION BRIDGE';
      if (simGoalEl) simGoalEl.textContent = 'Find the strongest primary sources on local-first AI and prepare a structured brief.';
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
            <span style="font-family: var(--font-terminal); font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #5c756e;">DOM Tree Grounded</span>
          </div>
        `;
      }
    }
    renderSimEvents();
  }

  if (tabDesktopBtn && tabBrowserBtn) {
    tabDesktopBtn.addEventListener('click', () => {
      simMode = 'desktop';
      tabDesktopBtn.classList.add('active');
      tabBrowserBtn.classList.remove('active');
      simStep = 0;
      updateSimUI();
    });

    tabBrowserBtn.addEventListener('click', () => {
      simMode = 'browser';
      tabBrowserBtn.classList.add('active');
      tabDesktopBtn.classList.remove('active');
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
      id: 'desktop',
      index: '01',
      label: 'Desktop OS Actuation & Control',
      icon: 'mouse-pointer-2',
      color: '#df6b48',
      title: 'Full OS Automation & Window Control',
      body: 'Hybrid targeting uses Windows UIA Accessibility trees first and Vision LLM grounding as fallback. Move windows across monitors, automate hotkeys, click UI elements, and snapshot workspace states.',
      steps: [
        'UIA Target Grounding & Bezier mouse smoothing',
        'Multi-window workspace snapshot & restore',
        'Closed-loop perceptual dHash visual verification'
      ]
    },
    {
      id: 'browser',
      index: '02',
      label: 'Autonomous Web Research & Scraping',
      icon: 'search',
      color: '#62877e',
      title: 'Research the Open Web Across Tabs',
      body: 'Traces sources across tabs, parses complex DOM trees, extracts structured tabular data, and grounds evidence with precise citations—not guesswork.',
      steps: [
        'Scan active DOM & cluster primary evidence',
        'Extract tabular data and clean records',
        'Cross-verify findings across multiple sources'
      ]
    },
    {
      id: 'subsystems',
      index: '03',
      label: 'Native Subsystems: Email, Scheduler, Files',
      icon: 'layers-3',
      color: '#d9ab58',
      title: 'Memory-Aware Tools & Local Automation',
      body: 'Direct Microsoft Outlook COM and SMTP/IMAP integration with automated reply tracking, natural language & cron scheduler with meeting context gates, and vision-verified file conversions.',
      steps: [
        'Read & compose Outlook emails with financial risk filters',
        'Natural language scheduler ("every weekday at 9am")',
        'Convert PDF, DOCX, XLSX with Vision layout spot-check'
      ]
    },
    {
      id: 'safety',
      index: '04',
      label: 'Instant ESC Kill-Switch & Rollback',
      icon: 'shield-check',
      color: '#8fb7ab',
      title: 'Power With an Instant Handbrake',
      body: 'Hit ESC at any point to sever the LLM stream, abort tool actions, and halt audio. All file modifications and process terminations are snapshotted for instant atomic rollback.',
      steps: [
        'Global ESC key interruption halts SSE & voice',
        'SecurityGuard blocks critical system processes',
        'SnapshotManager enables single-command undo'
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
    { name: 'Google AI Studio (Gemini)', defaultTag: 'DEFAULT BRAIN', model: 'models/gemini-flash-lite-latest', desc: 'Fast reasoning, massive token capacity, and automated 35s rate-limit cooldown recovery.' },
    { name: 'NVIDIA NIM (Cloud)', defaultTag: 'VISION ENGINE', model: 'nvidia/llama-3.2-90b-vision-instruct', desc: 'Dedicated vision model grounding UI coordinates, screenshot diffs, and document layouts.' },
    { name: 'OpenAI Compatible', defaultTag: 'SUPPORTED', model: 'gpt-4o / gpt-4o-mini', desc: 'Standard OpenAI completion endpoint compatible with corporate and private endpoints.' },
    { name: 'Groq (Fast Inference)', defaultTag: 'ULTRA FAST', model: 'llama-3.3-70b-versatile', desc: 'High-throughput execution for instant intent routing and classification.' },
    { name: 'Ollama (Local Private)', defaultTag: 'OFFLINE', model: 'llama3.2 / deepseek-r1', desc: '100% private execution on your local GPU with no internet transmission.' }
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
            <i data-lucide="lock" style="width: 14px; height: 14px;"></i> OS Credential Store
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
