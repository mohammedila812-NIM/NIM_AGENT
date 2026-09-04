/* NIM JARVIS Holographic Command Core - Client Logic */

let bridge = null;

// Initialize Qt WebChannel
function initBridge() {
    if (typeof QWebChannel !== "undefined") {
        new QWebChannel(qt.webChannelTransport, function (channel) {
            bridge = channel.objects.nimBridge;
            console.log("Connected to Python nimBridge:", bridge);

            // Connect Signals from Python
            bridge.agentLogReceived.connect(onAgentLog);
            bridge.voiceStateChanged.connect(onVoiceState);
            bridge.taskProgressChanged.connect(onTaskProgress);
            bridge.systemStatsChanged.connect(onSystemStats);
            bridge.toastReceived.connect(onToast);

            showToast("CONNECTED", "Neural bridge established with NIM OS Core.");
        });
    } else {
        console.warn("QWebChannel not available, running in standalone browser mode.");
    }
}

// Background Canvas WebGL / Holographic Arc Reactor
function initCanvas() {
    const canvas = document.getElementById("bg-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resize);
    resize();

    let angle = 0;
    const particles = [];
    for (let i = 0; i < 40; i++) {
        particles.push({
            r: 50 + Math.random() * 180,
            speed: (Math.random() - 0.5) * 0.02,
            size: 1 + Math.random() * 2,
            angle: Math.random() * Math.PI * 2
        });
    }

    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width / 2;
        const cy = canvas.height * 0.42;

        angle += 0.008;

        // Outer concentric rings
        ctx.save();
        ctx.translate(cx, cy);

        // Core glow
        const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, 200);
        grad.addColorStop(0, "rgba(255, 23, 40, 0.25)");
        grad.addColorStop(0.5, "rgba(100, 0, 15, 0.08)");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, 200, 0, Math.PI * 2);
        ctx.fill();

        // Rotating Arc 1
        ctx.strokeStyle = "rgba(255, 99, 112, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 130, angle, angle + Math.PI * 1.2);
        ctx.stroke();

        // Rotating Arc 2
        ctx.strokeStyle = "rgba(255, 23, 40, 0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 100, -angle * 1.5, -angle * 1.5 + Math.PI * 0.8);
        ctx.stroke();

        // Rotating Arc 3 (Inner)
        ctx.strokeStyle = "rgba(255, 173, 179, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 70, angle * 2, angle * 2 + Math.PI * 1.5);
        ctx.stroke();

        // Particles
        particles.forEach(p => {
            p.angle += p.speed;
            const px = Math.cos(p.angle) * p.r;
            const py = Math.sin(p.angle) * p.r;
            ctx.fillStyle = "rgba(255, 99, 112, 0.7)";
            ctx.beginPath();
            ctx.arc(px, py, p.size, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
        requestAnimationFrame(render);
    }
    render();
}

// UI Handlers
function onAgentLog(payloadJson) {
    try {
        const data = JSON.parse(payloadJson);
        const feed = document.getElementById("agent-log-feed");
        if (!feed) return;
        const line = document.createElement("div");
        line.innerHTML = `<strong>[${data.level.toUpperCase()}]</strong> ${escapeHtml(data.text)}`;
        feed.appendChild(line);
        feed.scrollTop = feed.scrollHeight;
    } catch (e) {
        console.error("Failed to parse log payload", e);
    }
}

function onVoiceState(payloadJson) {
    try {
        const data = JSON.parse(payloadJson);
        const micBtn = document.getElementById("voice-mic-btn");
        const statusTxt = document.getElementById("voice-status-text");

        if (data.state === "listening") {
            micBtn?.classList.add("listening");
            if (statusTxt) statusTxt.textContent = "Listening... " + (data.transcript || "");
        } else {
            micBtn?.classList.remove("listening");
            if (statusTxt) statusTxt.textContent = data.transcript ? `Heard: "${data.transcript}"` : "Ready.";
        }
    } catch (e) {
        console.error("Failed to parse voice payload", e);
    }
}

function onTaskProgress(payloadJson) {
    try {
        const data = JSON.parse(payloadJson);
        const subtext = document.getElementById("core-subtext");
        if (subtext && data.task) {
            subtext.textContent = `TASK: ${data.task.toUpperCase()} [${data.status.toUpperCase()}]`;
        }
    } catch (e) {
        console.error("Failed to parse task payload", e);
    }
}

function onSystemStats(payloadJson) {
    try {
        const data = JSON.parse(payloadJson);
        const cpuEl = document.getElementById("stat-cpu");
        const ramEl = document.getElementById("stat-ram");
        if (cpuEl) cpuEl.textContent = `${data.cpu}%`;
        if (ramEl) ramEl.textContent = `${data.ram}%`;
    } catch (e) {
        console.error("Failed to parse stats", e);
    }
}

function onToast(payloadJson) {
    try {
        const data = JSON.parse(payloadJson);
        showToast(data.title, data.message);
    } catch (e) {
        console.error("Failed to parse toast", e);
    }
}

function showToast(title, message) {
    const container = document.getElementById("toasts");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(message)}</div>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// User Actions
document.addEventListener("DOMContentLoaded", () => {
    initCanvas();
    initBridge();

    const micBtn = document.getElementById("voice-mic-btn");
    micBtn?.addEventListener("click", () => {
        if (bridge) {
            bridge.toggleMic();
        } else {
            showToast("DEV MODE", "Mic button clicked in browser.");
        }
    });

    const cmdInput = document.getElementById("cmd-input");
    const execBtn = document.getElementById("btn-exec-cmd");

    function executeCommand() {
        const text = cmdInput.value.trim();
        if (!text) return;
        cmdInput.value = "";
        
        onAgentLog(JSON.stringify({ text: `User Command: ${text}`, level: "command", ts: Date.now() }));
        if (bridge) {
            bridge.submitCommand(text);
        } else {
            showToast("COMMAND", `Executed: ${text}`);
        }
    }

    execBtn?.addEventListener("click", executeCommand);
    cmdInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            executeCommand();
        }
    });

    document.getElementById("btn-clear-logs")?.addEventListener("click", () => {
        const feed = document.getElementById("agent-log-feed");
        if (feed) feed.innerHTML = "";
    });

    document.getElementById("btn-anchors")?.addEventListener("click", () => {
        cmdInput.value = "List all saved coordinate anchors";
        executeCommand();
    });

    document.getElementById("btn-subagents")?.addEventListener("click", () => {
        cmdInput.value = "Show subagent blackboard findings and swarm status";
        executeCommand();
    });

    document.getElementById("btn-quick-calibrate")?.addEventListener("click", () => {
        cmdInput.value = "Calibrate primary monitor screen coordinates";
        executeCommand();
    });

    document.getElementById("btn-list-mon")?.addEventListener("click", () => {
        cmdInput.value = "List all connected monitors and DPI scaling";
        executeCommand();
    });
});
