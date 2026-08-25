import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowDown, ArrowRight, ArrowUpRight, Braces, Check, Chrome, CircleDot, Code2, Compass, Download, Eye, Fingerprint, Globe2, Layers3, LockKeyhole, Menu, MousePointer2, Network, PanelTop, Pause, Play, ScanSearch, Search, ShieldAlert, ShieldCheck, Terminal, X, Zap, type LucideIcon } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import sidePanelReference from '@assets/image_1787633885237.png';

const queryClient = new QueryClient();

const features: { id: string; index: string; label: string; icon: LucideIcon; body: string; color: string }[] = [
  { id: 'research', index: '01', label: 'Research the open web', icon: Search, body: 'NIM traces a question across tabs, follows the useful thread, and leaves you with evidence—not a confident guess.', color: 'teal' },
  { id: 'control', index: '02', label: 'Control your browser', icon: MousePointer2, body: 'Navigate, click, type, scroll, and switch context like a careful operator. Every action is visible and reversible.', color: 'coral' },
  { id: 'extract', index: '03', label: 'Return structure', icon: Braces, body: 'Turn messy pages into clean rows, fields, and decisions. Export what matters, not a pile of copied tabs.', color: 'amber' },
];

const providers = ['Custom endpoint', 'NVIDIA NIM', 'OpenAI-compatible', 'Ollama', 'Any provider'];

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Logo() {
  return (
    <a href="#top" className="focus-ring flex items-center gap-3" data-testid="link-logo">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-[#df6b48] text-[#f4f2ec]">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-current" />
      </span>
      <span className="mono text-[13px] font-bold tracking-[.16em]">NIM<span className="text-[#df6b48]">.</span></span>
    </a>
  );
}

function Nav({ onDownload }: { onDownload: (browser: string) => void }) {
  const [open, setOpen] = useState(false);
  const links = [['Capability', 'capability'], ['Method', 'method'], ['Safety', 'safety'], ['Download', 'download']];
  return (
    <header className="fixed left-0 right-0 top-0 z-40 border-b border-[#10203a]/10 bg-[#f4f2ec]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between px-5 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-8 md:flex">
          {links.map(([label, id]) => <a key={id} href={`#${id}`} className="focus-ring mono text-[10px] uppercase tracking-[.14em] text-[#536071] transition-colors hover:text-[#10203a]" data-testid={`link-nav-${id}`}>{label}</a>)}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <a href="#providers" className="focus-ring rounded-full px-3 py-2 text-sm text-[#536071] transition hover:text-[#10203a]" data-testid="link-providers">Bring your model</a>
          <button onClick={() => onDownload('Chrome')} className="focus-ring group flex items-center gap-2 rounded-full bg-[#10203a] px-4 py-2.5 text-sm font-semibold text-[#f4f2ec] transition hover:bg-[#263b59]" data-testid="button-nav-download">
            <Chrome size={15} /> Download source <ArrowUpRight size={14} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </button>
        </div>
        <button className="focus-ring rounded-md p-2 md:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu" data-testid="button-mobile-menu">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && <div className="border-t border-[#10203a]/10 bg-[#f4f2ec] px-5 py-5 md:hidden">
        <div className="grid gap-2">
          {links.map(([label, id]) => <a key={id} onClick={() => setOpen(false)} href={`#${id}`} className="mono border-b border-[#10203a]/10 py-3 text-[11px] uppercase tracking-[.14em]" data-testid={`link-mobile-${id}`}>{label}</a>)}
          <button onClick={() => { setOpen(false); onDownload('source'); }} className="mt-3 flex items-center justify-center gap-2 rounded-full bg-[#10203a] px-4 py-3 text-sm font-semibold text-[#f4f2ec]" data-testid="button-mobile-download"><Download size={15} /> Download source</button>
        </div>
      </div>}
    </header>
  );
}

function BrowserWindow({ running, setRunning }: { running: boolean; setRunning: (value: boolean) => void }) {
  const [active, setActive] = useState(0);
  const events = [
    ['Reading', 'openai.com/research', 'Scanning page structure'],
    ['Finding', 'arxiv.org/abs/2406.09123', 'Comparing source signals'],
    ['Extracting', 'notion.so/briefing', 'Mapping 8 useful fields'],
  ];
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % events.length), 2200);
    return () => window.clearInterval(timer);
  }, [running, events.length]);
  return (
    <div className="nim-float relative mx-auto w-full max-w-[690px]">
      <div className="absolute -inset-5 rounded-[28px] bg-[#8fb7ab]/20 blur-2xl" />
      <div className="relative overflow-hidden rounded-[16px] border border-[#adc4c0] bg-[#e8ece5] shadow-[0_30px_90px_rgba(16,27,44,.2)]">
        <div className="flex h-10 items-center gap-2 border-b border-[#b5c5bf] bg-[#d8e0da] px-4">
          <span className="h-2 w-2 rounded-full bg-[#c7775e]" /><span className="h-2 w-2 rounded-full bg-[#d6a753]" /><span className="h-2 w-2 rounded-full bg-[#82a89d]" />
          <div className="ml-5 flex h-6 max-w-[270px] flex-1 items-center gap-2 rounded-md border border-[#b8c8c1] bg-[#e9eee9] px-2.5 text-[9px] text-[#6d7a7c]"><Globe2 size={11} /> nim.local / active-session</div>
          <div className="mono text-[9px] text-[#6d7a7c]">LOCAL MODE</div>
        </div>
        <div className="grid min-h-[350px] grid-cols-[1fr_230px] md:min-h-[385px] md:grid-cols-[1fr_255px]">
          <div className="relative overflow-hidden bg-[#f5f5ef] p-5 md:p-8">
            <div className="nim-scan absolute left-0 right-0 top-0 h-16 bg-gradient-to-b from-transparent via-[#9ec5b7]/40 to-transparent" />
            <div className="mb-8 flex items-center justify-between border-b border-[#c8d1c9] pb-3"><span className="mono text-[9px] uppercase tracking-[.18em] text-[#5d726e]">Web surface / 03</span><span className="flex items-center gap-1.5 text-[10px] text-[#71948b]"><CircleDot size={9} className={running ? 'nim-pulse' : ''} /> {running ? 'Agent active' : 'Session paused'}</span></div>
            <div className="max-w-[350px]">
              <div className="mb-4 h-2 w-20 rounded bg-[#c6d3cc]" />
              <div className="mb-3 h-8 w-[92%] rounded bg-[#1b3041]/90" />
              <div className="mb-5 h-8 w-[68%] rounded bg-[#1b3041]/90" />
              <div className="grid gap-2">
                {[82, 67, 91, 58, 74].map((width, i) => <div key={i} className="flex gap-2"><div className="h-1.5 rounded bg-[#c3d0c9]" style={{ width: `${width}%` }} /><div className="h-1.5 w-10 rounded bg-[#d8ded7]" /></div>)}
              </div>
              <div className="mt-8 grid grid-cols-2 gap-3">
                <div className="h-16 rounded border border-[#cad4cd] bg-[#e9eee8]" />
                <div className="h-16 rounded border border-[#cad4cd] bg-[#e9eee8]" />
              </div>
            </div>
            <div className="absolute bottom-5 left-5 flex items-center gap-2 rounded-full border border-[#b9cfc4] bg-[#edf3ed] px-3 py-1.5 md:bottom-8 md:left-8"><span className="h-1.5 w-1.5 rounded-full bg-[#719f91]" /><span className="mono text-[8px] uppercase tracking-[.12em] text-[#5c756e]">DOM understood</span></div>
          </div>
          <div className="border-l border-[#b5c5bf] bg-[#10203a] p-4 text-[#e5ebe2] md:p-5">
            <div className="mb-5 flex items-center justify-between"><span className="mono text-[9px] uppercase tracking-[.16em] text-[#a2b9b0]">NIM / operator</span><button onClick={() => setRunning(!running)} className="focus-ring rounded-md border border-[#617582] p-1.5 text-[#b9cfc4] transition hover:border-[#df6b48] hover:text-[#f1a186]" aria-label={running ? 'Pause agent' : 'Run agent'} data-testid="button-agent-toggle">{running ? <Pause size={13} /> : <Play size={13} />}</button></div>
            <div className="mb-6 text-[12px] leading-5 text-[#ecf0ea]">Find the strongest primary sources on local-first AI and prepare a brief.</div>
            <div className="space-y-4">
              {events.map(([label, url, detail], i) => <div key={label} className={`relative border-l pl-3 transition-all duration-500 ${active === i && running ? 'border-[#df6b48] text-[#f1a186]' : i < active && running ? 'border-[#7ea99c] text-[#c9d8cf]' : 'border-[#405469] text-[#738596]'}`}><div className="mono text-[8px] uppercase tracking-[.13em]">{label}</div><div className="mt-1 truncate text-[10px] text-[#d7e0d8]">{url}</div><div className="mt-1 text-[9px] text-[#78908d]">{active === i && running ? detail : i < active ? 'Complete' : 'Queued'}</div></div>)}
            </div>
            <div className="mt-7 rounded-lg border border-[#31485d] bg-[#182e42] p-3"><div className="mb-2 flex items-center gap-2 text-[10px] text-[#b9d2c6]"><ShieldCheck size={12} /> Approval checkpoint</div><div className="text-[10px] leading-4 text-[#8fa6a2]">NIM will pause before publishing or sending anything.</div></div>
          </div>
        </div>
      </div>
      <div className="absolute -right-3 -top-5 hidden rounded-lg border border-[#d49b80] bg-[#fff1ea] px-3 py-2 shadow-[0_10px_25px_rgba(16,27,44,.12)] sm:block"><div className="mono text-[8px] uppercase tracking-[.13em] text-[#aa5d47]">Human in the loop</div><div className="mt-1 text-[10px] text-[#7f5143]">Nothing leaves without you.</div></div>
    </div>
  );
}

function Hero({ onDownload }: { onDownload: (browser: string) => void }) {
  const [running, setRunning] = useState(true);
  return (
    <section id="top" className="relative overflow-hidden px-5 pb-24 pt-36 lg:px-8 lg:pb-32 lg:pt-48">
      <div className="grid-paper absolute inset-0 opacity-60" />
      <div className="absolute right-[-10%] top-24 h-[420px] w-[420px] rounded-full bg-[#a8c8c1]/25 blur-3xl" />
      <div className="relative mx-auto max-w-[1240px]">
        <div className="mb-14 grid items-end gap-12 lg:grid-cols-[.9fr_1.1fr] lg:gap-20">
          <div className="nim-rise" style={{ animationDelay: '.05s' }}>
            <div className="mono mb-6 flex items-center gap-3 text-[10px] uppercase tracking-[.19em] text-[#62877e]"><span className="h-1.5 w-1.5 rounded-full bg-[#df6b48]" /> Browser intelligence / 01</div>
            <h1 className="max-w-[600px] text-[clamp(3.7rem,8.3vw,7.8rem)] font-semibold leading-[.88] tracking-[-.075em] text-[#10203a]">The web,<br /><span className="serif font-normal italic text-[#62877e]">understood.</span></h1>
            <p className="mt-8 max-w-[470px] text-[17px] leading-7 text-[#536071]">NIM is a browser-resident agent that can research, navigate, and act—then pause precisely where your judgment matters.</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button onClick={() => onDownload('source')} className="focus-ring group flex items-center gap-3 rounded-full bg-[#df6b48] px-5 py-3.5 text-sm font-semibold text-[#f9f3ec] shadow-[0_10px_25px_rgba(223,107,72,.22)] transition hover:-translate-y-0.5 hover:bg-[#cc5d3e]" data-testid="button-hero-chrome"><Download size={17} /> Download source <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" /></button>
              <a href="#download" className="focus-ring flex items-center gap-2 rounded-full border border-[#10203a]/20 px-5 py-3.5 text-sm font-semibold text-[#10203a] transition hover:border-[#10203a]/50 hover:bg-[#10203a]/5" data-testid="link-hero-install">How to install <ArrowDown size={16} /></a>
            </div>
            <div className="mono mt-5 flex items-center gap-2 text-[9px] uppercase tracking-[.12em] text-[#788383]"><LockKeyhole size={11} /> Local by default <span className="mx-1 text-[#b4b8b0]">·</span> Your keys, your browser</div>
          </div>
          <div className="nim-rise lg:pb-2" style={{ animationDelay: '.2s' }}><BrowserWindow running={running} setRunning={setRunning} /></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-5 border-t border-[#10203a]/15 pt-5">
          <span className="mono text-[9px] uppercase tracking-[.17em] text-[#718078]">A new kind of browser extension</span>
          <div className="flex flex-wrap gap-x-7 gap-y-2 text-[11px] text-[#62716e]"><span className="flex items-center gap-2"><Eye size={13} /> See every step</span><span className="flex items-center gap-2"><Pause size={13} /> Pause before action</span><span className="flex items-center gap-2"><Code2 size={13} /> Bring your provider</span></div>
        </div>
      </div>
    </section>
  );
}

function Capability() {
  const [selected, setSelected] = useState(0);
  const feature = features[selected];
  const FeatureIcon = feature.icon;
  return (
    <section id="capability" className="bg-[#10203a] px-5 py-24 text-[#f4f2ec] lg:px-8 lg:py-32">
      <div className="mx-auto max-w-[1240px]">
        <div className="mb-16 max-w-[710px]"><div className="mono mb-5 text-[10px] uppercase tracking-[.2em] text-[#a8c8c1]">What it can do / 02</div><h2 className="text-[clamp(2.7rem,5vw,5.3rem)] font-semibold leading-[.94] tracking-[-.06em]">Not a chatbot.<br /><span className="serif font-normal italic text-[#df9a82]">An operator.</span></h2><p className="mt-7 max-w-[510px] text-[16px] leading-7 text-[#acbbc0]">Give NIM an outcome. It figures out the path through the browser, keeps you close to the work, and hands back something you can use.</p></div>
        <div className="grid gap-12 lg:grid-cols-[.68fr_1.32fr] lg:gap-24">
          <div className="border-t border-[#506174]">
            {features.map((item, i) => { const Icon = item.icon; return <button key={item.id} onClick={() => setSelected(i)} className={`focus-ring group flex w-full items-center justify-between border-b border-[#506174] py-5 text-left transition ${selected === i ? 'text-[#f4f2ec]' : 'text-[#718493] hover:text-[#cad5d1]'}`} data-testid={`button-capability-${item.id}`}><span className="flex items-center gap-4"><span className={`grid h-9 w-9 place-items-center rounded-full border transition ${selected === i ? 'border-[#df6b48] bg-[#df6b48] text-[#10203a]' : 'border-[#526477]'}`}><Icon size={16} /></span><span><span className="mono mr-3 text-[9px] text-[#7e948f]">{item.index}</span><span className="text-[15px]">{item.label}</span></span></span><ArrowRight size={16} className={`transition-transform ${selected === i ? 'translate-x-0 text-[#df6b48]' : '-translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'}`} /></button>; })}
            <div className="mt-9 rounded-lg border border-[#31465b] bg-[#172d42] p-4"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#c4d8ce]"><Zap size={13} className="text-[#df6b48]" /> Built for intent, not prompts</div><p className="mt-2 text-[11px] leading-5 text-[#81959a]">NIM can keep a plan alive across the tabs where work actually happens.</p></div>
          </div>
          <div className="relative min-h-[360px] overflow-hidden rounded-2xl border border-[#40576b] bg-[#172d42] p-6 md:p-10">
            <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-[#6d9d91]/10 blur-3xl" />
              <div className="relative flex h-full flex-col justify-between">
              <div><div className="mb-7 flex items-center justify-between"><span className="mono text-[9px] uppercase tracking-[.18em] text-[#7eaaa0]">Capability / {feature.index}</span><span className="rounded-full border border-[#486371] px-2 py-1 text-[9px] text-[#8ba9a3]">Live preview</span></div><div className="flex items-start gap-5"><div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl ${selected === 0 ? 'bg-[#a8c8c1] text-[#10203a]' : selected === 1 ? 'bg-[#df6b48] text-[#10203a]' : 'bg-[#d9ab58] text-[#10203a]'}`}><FeatureIcon size={25} /></div><div><h3 className="text-2xl font-semibold tracking-[-.04em]">{feature.label}</h3><p className="mt-3 max-w-[440px] text-[15px] leading-7 text-[#aebec0]">{feature.body}</p></div></div></div>
              <div className="mt-12 border-t border-[#40576b] pt-5"><div className="flex items-center justify-between text-[10px] text-[#88a19f]"><span className="mono uppercase tracking-[.13em]">{selected === 0 ? 'Source trail' : selected === 1 ? 'Action trace' : 'Structured output'}</span><span className="flex items-center gap-1.5 text-[#a8c8c1]"><CircleDot size={9} className="nim-pulse" /> Ready</span></div><div className="mt-4 grid gap-2">{(selected === 0 ? ['Open 12 relevant sources', 'Cluster by primary evidence', 'Cite the strongest 6'] : selected === 1 ? ['Open research workspace', 'Fill comparison matrix', 'Pause before submit'] : ['Detect page schema', 'Normalize 24 results', 'Export to your workflow']).map((line, i) => <div key={line} className="flex items-center gap-3 rounded-md bg-[#20394e] px-3 py-2.5 text-[11px] text-[#c8d7d1]"><span className="mono text-[9px] text-[#739b91]">0{i + 1}</span>{line}<Check size={13} className="ml-auto text-[#a8c8c1]" /></div>)}</div></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SidePanelShowcase() {
  return (
    <section className="border-y border-[#10203a]/10 bg-[#f0f1eb] px-5 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 lg:grid-cols-[1.05fr_.95fr] lg:gap-24">
        <div className="relative mx-auto w-full max-w-[430px]">
          <div className="absolute -inset-8 rounded-[36px] bg-[#8fb7ab]/20 blur-3xl" />
          <div className="relative rounded-[22px] border border-[#617581] bg-[#0d1729] p-2 shadow-[0_30px_80px_rgba(16,27,44,.2)]">
            <div className="overflow-hidden rounded-[16px] border border-[#263750] bg-[#0f192c]">
              <img src={sidePanelReference} alt="NIM Agent browser side panel showing chat, task status, and controls" className="block h-auto w-full" />
            </div>
            <div className="pointer-events-none absolute -right-5 top-14 rounded-lg border border-[#d49b80] bg-[#fff1ea] px-3 py-2 shadow-[0_10px_25px_rgba(16,27,44,.12)]">
              <div className="mono text-[8px] uppercase tracking-[.13em] text-[#aa5d47]">The actual interface</div>
              <div className="mt-1 text-[10px] text-[#7f5143]">Six tools. One side panel.</div>
            </div>
          </div>
        </div>
        <div>
          <div className="mono mb-5 text-[10px] uppercase tracking-[.2em] text-[#62877e]">Inside the browser / 03</div>
          <h2 className="text-[clamp(2.8rem,5vw,5.2rem)] font-semibold leading-[.93] tracking-[-.065em] text-[#10203a]">A small panel<br /><span className="serif font-normal italic text-[#62877e]">for big tasks.</span></h2>
          <p className="mt-7 max-w-[450px] text-[16px] leading-7 text-[#536071]">NIM lives in a side panel so the work stays in view. Chat, task status, reasoning, notes, security, and settings are all one shortcut away.</p>
          <div className="mt-8 flex flex-wrap gap-2">
            {['Chat & control', 'Reasoning trace', 'Tasks & macros', 'Research notes', 'Security log', 'Settings'].map((label) => <span key={label} className="rounded-full border border-[#aebdb5] bg-[#e8eee8] px-3 py-2 text-[11px] text-[#536b67]">{label}</span>)}
          </div>
          <div className="mt-8 flex items-center gap-3 border-t border-[#c5d0c8] pt-5 text-[11px] text-[#6b7976]"><kbd className="rounded border border-[#b8c6be] bg-[#e8eee8] px-2 py-1 font-mono text-[10px] text-[#10203a]">Alt</kbd><span>+</span><kbd className="rounded border border-[#b8c6be] bg-[#e8eee8] px-2 py-1 font-mono text-[10px] text-[#10203a]">Shift</kbd><span>+</span><kbd className="rounded border border-[#b8c6be] bg-[#e8eee8] px-2 py-1 font-mono text-[10px] text-[#10203a]">N</kbd><span className="ml-1">opens the panel</span></div>
        </div>
      </div>
    </section>
  );
}

function Method() {
  const steps: [string, string, string, LucideIcon][] = [
    ['01', 'Name the outcome', 'Tell NIM what finished looks like. “Make a shortlist” beats “search for things.”', Compass],
    ['02', 'Watch it reason', 'NIM builds a visible plan, reads the right pages, and adjusts when the web gets messy.', ScanSearch],
    ['03', 'Keep the boundary', 'When an action has consequences, NIM stops. You review the exact step before it runs.', ShieldCheck],
    ['04', 'Take the result', 'A clear brief, a structured table, or a completed browser task—ready for your next move.', Layers3],
  ];
  return (
    <section id="method" className="relative overflow-hidden px-5 py-24 lg:px-8 lg:py-36">
      <div className="absolute right-[-8%] top-24 h-[500px] w-[500px] rounded-full bg-[#d9ab58]/10 blur-3xl" />
      <div className="relative mx-auto max-w-[1240px]">
        <div className="mb-20 grid gap-7 lg:grid-cols-[.7fr_1fr]"><div><div className="mono mb-5 text-[10px] uppercase tracking-[.2em] text-[#62877e]">How NIM works / 03</div><h2 className="text-[clamp(2.8rem,5vw,5.4rem)] font-semibold leading-[.93] tracking-[-.065em]">A loop you<br /><span className="serif font-normal italic text-[#df6b48]">can trust.</span></h2></div><p className="max-w-[440px] self-end text-[16px] leading-7 text-[#536071]">The best agent is not the one that moves fastest. It is the one that makes its next move legible.</p></div>
        <div className="relative grid gap-0 md:grid-cols-4">{steps.map(([number, title, body, Icon], i) => <div key={number} className="reveal-ready group relative border-t border-[#10203a]/20 pb-10 pt-6 md:border-l md:border-t-0 md:pb-0 md:pl-6 md:pt-0" style={{ transitionDelay: `${i * 100}ms` }}><div className="mb-12 flex items-center justify-between md:mb-16 md:justify-start md:gap-4"><span className="mono text-[10px] text-[#df6b48]">{number}</span><span className="grid h-9 w-9 place-items-center rounded-full border border-[#bfc8bf] text-[#62877e] transition group-hover:border-[#df6b48] group-hover:bg-[#df6b48] group-hover:text-[#f4f2ec]"><Icon size={16} /></span></div><h3 className="text-xl font-semibold tracking-[-.035em] text-[#10203a]">{title}</h3><p className="mt-3 max-w-[230px] text-[13px] leading-6 text-[#6b747b]">{body}</p></div>)}</div>
        <div className="mt-24 grid items-center gap-8 rounded-2xl border border-[#c2cec7] bg-[#e7ece5] p-6 md:p-8 lg:grid-cols-[1fr_auto]"><div><div className="mono mb-3 text-[9px] uppercase tracking-[.18em] text-[#62877e]">The agentic loop</div><div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[#10203a]"><span className="rounded-full bg-[#f4f2ec] px-3 py-2">Observe</span><ArrowRight size={14} className="text-[#df6b48]" /><span className="rounded-full bg-[#f4f2ec] px-3 py-2">Plan</span><ArrowRight size={14} className="text-[#df6b48]" /><span className="rounded-full bg-[#f4f2ec] px-3 py-2">Act</span><ArrowRight size={14} className="text-[#df6b48]" /><span className="rounded-full bg-[#df6b48] px-3 py-2 text-[#f4f2ec]">Ask</span></div></div><div className="max-w-[260px] text-[12px] leading-5 text-[#61706e]">A quiet interruption at the exact moment your intent becomes consequential.</div></div>
      </div>
    </section>
  );
}

function Architecture() {
  return (
    <section className="bg-[#e4e9e3] px-5 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto grid max-w-[1240px] items-center gap-16 lg:grid-cols-[.85fr_1.15fr]">
        <div><div className="mono mb-5 text-[10px] uppercase tracking-[.2em] text-[#62877e]">Under the hood / 05</div><h2 className="text-[clamp(2.8rem,5vw,5.2rem)] font-semibold leading-[.93] tracking-[-.065em] text-[#10203a]">Thin by design.<br /><span className="serif font-normal italic text-[#62877e]">Sharp by default.</span></h2><p className="mt-7 max-w-[460px] text-[16px] leading-7 text-[#536071]">NIM lives where the work lives: inside your browser. No developer backend, no proxy, no mysterious copy of your session. Connect any OpenAI-compatible endpoint you trust.</p><a href="#safety" className="focus-ring mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#10203a] underline decoration-[#df6b48] decoration-2 underline-offset-4 transition hover:text-[#df6b48]" data-testid="link-architecture-safety">See the safety model <ArrowUpRight size={15} /></a></div>
        <div className="relative overflow-hidden rounded-2xl border border-[#bcc9c1] bg-[#f4f2ec] p-6 shadow-[0_20px_55px_rgba(16,27,44,.08)] md:p-10"><div className="mb-8 flex items-center justify-between border-b border-[#cbd3ca] pb-4"><span className="mono text-[9px] uppercase tracking-[.18em] text-[#62877e]">NIM / local topology</span><span className="flex items-center gap-2 text-[10px] text-[#62877e]"><span className="h-1.5 w-1.5 rounded-full bg-[#719f91]" /> Connected</span></div><div className="relative grid gap-3"><div className="grid grid-cols-[1fr_36px_1fr] items-center gap-2"><div className="rounded-lg border border-[#a9c4ba] bg-[#e4eee7] p-4"><PanelTop size={17} className="mb-4 text-[#62877e]" /><div className="text-sm font-semibold text-[#10203a]">Your browser</div><div className="mono mt-1 text-[8px] uppercase tracking-[.13em] text-[#73827d]">Tabs · DOM · session</div></div><div className="grid place-items-center"><Network size={18} className="text-[#df6b48]" /></div><div className="rounded-lg border border-[#d0b4a6] bg-[#fff0e9] p-4"><Terminal size={17} className="mb-4 text-[#c66b50]" /><div className="text-sm font-semibold text-[#10203a]">NIM runtime</div><div className="mono mt-1 text-[8px] uppercase tracking-[.13em] text-[#8d766e]">Plan · observe · act</div></div></div><div className="mx-auto h-7 border-l border-dashed border-[#9db8ad]" /><div className="mx-auto flex w-full max-w-[300px] items-center gap-3 rounded-lg border border-[#c3cbd0] bg-[#edf0ed] p-4"><Fingerprint size={18} className="text-[#62877e]" /><div><div className="text-sm font-semibold text-[#10203a]">Your provider</div><div className="mono mt-1 text-[8px] uppercase tracking-[.13em] text-[#73827d]">Your key · your choice</div></div><LockKeyhole size={15} className="ml-auto text-[#62877e]" /></div></div><div className="mt-8 border-t border-[#cbd3ca] pt-5 text-[11px] leading-5 text-[#687570]">The model sees only what the active task needs. NIM keeps the browser boundary intact.</div></div>
      </div>
    </section>
  );
}

function Providers() {
  const [active, setActive] = useState('Custom endpoint');
  return (
    <section id="providers" className="px-5 py-24 lg:px-8 lg:py-32"><div className="mx-auto max-w-[1240px]"><div className="flex flex-col justify-between gap-8 border-b border-[#10203a]/20 pb-10 md:flex-row md:items-end"><div><div className="mono mb-5 text-[10px] uppercase tracking-[.2em] text-[#62877e]">Bring your intelligence / 06</div><h2 className="text-[clamp(2.6rem,5vw,5rem)] font-semibold leading-[.94] tracking-[-.06em]">Your model.<br /><span className="serif font-normal italic text-[#df6b48]">Your terms.</span></h2></div><p className="max-w-[350px] text-[15px] leading-6 text-[#65716f]">NIM connects to any custom OpenAI-compatible endpoint. NVIDIA NIM is the default test setup—not an endorsement.</p></div><div className="grid gap-10 pt-10 lg:grid-cols-[.8fr_1.2fr] lg:gap-20"><div className="space-y-2">{providers.map((provider, i) => <button key={provider} onClick={() => setActive(provider)} className={`focus-ring flex w-full items-center justify-between rounded-lg border px-4 py-4 text-left transition ${active === provider ? 'border-[#62877e] bg-[#e5eee8]' : 'border-[#cbd0ca] hover:border-[#8ca79d]'}`} data-testid={`button-provider-${provider.toLowerCase().replace(/\s+/g, '-')}`}><span className="flex items-center gap-3"><span className="mono text-[9px] text-[#83918b]">0{i + 1}</span><span className="font-semibold text-[#10203a]">{provider}</span></span>{active === provider && <Check size={16} className="text-[#62877e]\" />}</button>)}</div><div className="rounded-2xl bg-[#10203a] p-7 text-[#f4f2ec] md:p-10"><div className="flex items-start justify-between"><div><div className="mono text-[9px] uppercase tracking-[.18em] text-[#a8c8c1]">Selected provider</div><h3 className="mt-3 text-3xl font-semibold tracking-[-.05em]">{active}</h3></div><div className="grid h-12 w-12 place-items-center rounded-xl bg-[#a8c8c1] text-[#10203a]"><Zap size={22} /></div></div><div className="mt-10 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-[#3b5366] bg-[#172d42] p-4"><div className="mono text-[9px] uppercase tracking-[.14em] text-[#87a29a]">Credentials</div><div className="mt-2 flex items-center gap-2 text-sm"><LockKeyhole size={14} className="text-[#a8c8c1]" /> Stored locally</div></div><div className="rounded-lg border border-[#3b5366] bg-[#172d42] p-4"><div className="mono text-[9px] uppercase tracking-[.14em] text-[#87a29a]">Control</div><div className="mt-2 flex items-center gap-2 text-sm"><Fingerprint size={14} className="text-[#a8c8c1]" /> You choose the model</div></div></div><p className="mt-8 max-w-[470px] text-[13px] leading-6 text-[#aebfc0]">No forced account. No house model quietly standing between you and the web. NIM is the capable layer around the intelligence you select.</p></div></div></div></section>
  );
}

function Safety() {
  const items: [string, string, LucideIcon][] = [['No silent actions', 'Every click, keystroke, and navigation appears in a readable trace.', ShieldCheck], ['Approval gates', 'NIM pauses before sending, publishing, deleting, or buying.', ShieldAlert], ['Local credentials', 'Provider keys stay in your browser. We do not operate a developer backend.', LockKeyhole], ['Clear reset', 'Stop the run, close the session, or revoke access at any time.', Fingerprint]];
  return <section id="safety" className="border-y border-[#bfc9c1] bg-[#e7ece5] px-5 py-24 lg:px-8 lg:py-32"><div className="mx-auto grid max-w-[1240px] gap-14 lg:grid-cols-[.75fr_1.25fr] lg:gap-24"><div><div className="mono mb-5 text-[10px] uppercase tracking-[.2em] text-[#62877e]">The trust layer / 07</div><h2 className="text-[clamp(2.8rem,5vw,5.3rem)] font-semibold leading-[.93] tracking-[-.065em] text-[#10203a]">Power with<br /><span className="serif font-normal italic text-[#62877e]">a handbrake.</span></h2><p className="mt-7 max-w-[390px] text-[16px] leading-7 text-[#536071]">Automation should extend your agency, never quietly replace it. NIM makes the boundary part of the interface.</p></div><div className="grid gap-x-8 gap-y-10 sm:grid-cols-2">{items.map(([title, body, Icon], i) => <div key={title} className="reveal-ready border-t border-[#b7c5bd] pt-5" style={{ transitionDelay: `${i * 90}ms` }}><div className="mb-5 flex items-center justify-between"><Icon size={21} className="text-[#df6b48]" /><span className="mono text-[9px] text-[#899790]">0{i + 1}</span></div><h3 className="text-[16px] font-semibold text-[#10203a]">{title}</h3><p className="mt-2 text-[13px] leading-6 text-[#687570]">{body}</p></div>)}</div></div></section>;
}

function DownloadSection({ onDownload }: { onDownload: (browser: string) => void }) {
  return <section id="download" className="relative overflow-hidden bg-[#df6b48] px-5 py-24 text-[#10203a] lg:px-8 lg:py-32"><div className="absolute right-[-8%] top-[-30%] h-[480px] w-[480px] rounded-full border-[1px] border-[#f2b49d]/45" /><div className="absolute right-[2%] top-[-15%] h-[340px] w-[340px] rounded-full border-[1px] border-[#f2b49d]/35" /><div className="relative mx-auto max-w-[1240px]"><div className="grid gap-14 lg:grid-cols-[1fr_.8fr] lg:items-end"><div className="max-w-[780px]"><div className="mono mb-6 text-[10px] uppercase tracking-[.2em] text-[#784434]">Get the source / 08</div><h2 className="text-[clamp(3.5rem,8vw,8rem)] font-semibold leading-[.85] tracking-[-.08em]">Open a better<br /><span className="serif font-normal italic">way through.</span></h2><p className="mt-8 max-w-[480px] text-[16px] leading-7 text-[#784434]">NIM is free, editable, and non-commercial. Download the source, make it yours, and connect it to the model endpoint you choose.</p><div className="mt-9 flex flex-wrap gap-3"><button onClick={() => onDownload('source')} className="focus-ring flex items-center gap-3 rounded-full bg-[#10203a] px-5 py-3.5 text-sm font-semibold text-[#f4f2ec] transition hover:bg-[#263b59]" data-testid="button-download-source"><Download size={17} /> Download source <ArrowUpRight size={15} /></button></div></div><div className="rounded-2xl border border-[#a9503c]/40 bg-[#ed805f]/45 p-6"><div className="mono text-[9px] uppercase tracking-[.17em] text-[#784434]">Install it yourself</div><ol className="mt-5 space-y-4 text-[13px] leading-5 text-[#6c4035]"><li className="flex gap-3"><span className="mono text-[10px] text-[#9d4f3d]">01</span><span>Download and unzip the extension source.</span></li><li className="flex gap-3"><span className="mono text-[10px] text-[#9d4f3d]">02</span><span>Open your browser’s extensions page and enable developer mode.</span></li><li className="flex gap-3"><span className="mono text-[10px] text-[#9d4f3d]">03</span><span>Choose <strong>Load unpacked</strong> and select the extension folder.</span></li></ol><div className="mt-5 border-t border-[#a9503c]/35 pt-4 text-[11px] text-[#784434]">Works with Chrome, Edge, and other compatible Chromium browsers.</div></div></div><div className="mt-20 flex flex-wrap gap-x-8 gap-y-3 border-t border-[#a9503c]/35 pt-5 text-[10px] uppercase tracking-[.13em] text-[#784434]"><span>Editable source</span><span>No web store listing</span><span>Bring your provider</span><span>Human approval built in</span></div></div></section>;
}

function Footer() {
  return <footer className="bg-[#10203a] px-5 py-10 text-[#f4f2ec] lg:px-8"><div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-8 md:flex-row md:items-end"><div><Logo /><p className="mt-5 max-w-[290px] text-[12px] leading-5 text-[#8699a0]">A one-person, non-commercial hobby project for people who want more from the open web.</p></div><div className="flex flex-wrap gap-5 text-[11px] text-[#9cafad]"><a href="#capability" className="transition hover:text-[#f4f2ec]" data-testid="link-footer-capability">Capability</a><a href="#safety" className="transition hover:text-[#f4f2ec]" data-testid="link-footer-safety">Safety</a><a href="#download" className="transition hover:text-[#f4f2ec]" data-testid="link-footer-download">Download</a><a href="mailto:hello@nim.agent" className="transition hover:text-[#f4f2ec]" data-testid="link-footer-contact">Contact</a></div><div className="mono text-[9px] uppercase tracking-[.13em] text-[#627782]">© 2026 NIM Agent · Hobby project</div></div></footer>;
}

function Home() {
  const [notice, setNotice] = useState<string | null>(null);
  const revealRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    revealRef.current = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('is-visible'); }), { threshold: .12 });
    document.querySelectorAll('.reveal-ready').forEach((el) => revealRef.current?.observe(el));
    return () => revealRef.current?.disconnect();
  }, []);
  const onDownload = (browser: string) => {
    setNotice(browser === 'source' ? 'Source download link coming soon — NIM is distributed as an editable unpacked extension.' : 'NIM is distributed as source code, not through a browser web store.');
    window.setTimeout(() => setNotice(null), 4200);
  };
  return <div className="noise min-h-[100dvh] overflow-x-hidden bg-[#f4f2ec]"><Nav onDownload={onDownload} /><main><Hero onDownload={onDownload} /><Capability /><SidePanelShowcase /><Method /><Architecture /><Providers /><Safety /><DownloadSection onDownload={onDownload} /></main><Footer />{notice && <div className="fixed bottom-5 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-[520px] -translate-x-1/2 items-center gap-3 rounded-xl border border-[#66877e] bg-[#10203a] px-4 py-3 text-[12px] text-[#e3ece5] shadow-[0_20px_45px_rgba(16,27,44,.25)]" role="status" data-testid="status-download"><Check size={16} className="shrink-0 text-[#a8c8c1]" /><span>{notice}</span><button onClick={() => setNotice(null)} className="focus-ring ml-auto rounded p-1 text-[#9cb0b0] hover:text-[#f4f2ec]" aria-label="Dismiss notification" data-testid="button-dismiss-notice"><X size={15} /></button></div>}</div>;
}

function Router() {
  return <Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><Router /></RoutedErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;