// YT Summary Studio - Client Logic with Live Process Pipeline & Executive Presentation

const form = document.querySelector("#summarize-form");
const submitButton = document.querySelector("#submit-button");
const progress = document.querySelector("#progress");
const progressTitle = document.querySelector("#progress-title");
const progressDetail = document.querySelector("#progress-detail");
const progressPercent = document.querySelector("#progress-percent");
const progressBarFill = document.querySelector("#progress-bar-fill");
const terminalStream = document.querySelector("#terminal-stream");
const terminalStepBadge = document.querySelector("#terminal-step-badge");

const activeEngineText = document.querySelector("#active-engine-text");
const pacingCountdownChip = document.querySelector("#pacing-countdown-chip");
const pacingCountdownText = document.querySelector("#pacing-countdown-text");
const failoverNoticeChip = document.querySelector("#failover-notice-chip");
const failoverNoticeText = document.querySelector("#failover-notice-text");

const errorBox = document.querySelector("#error-box");
const errorMessage = document.querySelector("#error-message");
const result = document.querySelector("#result");
const toast = document.querySelector("#toast");

let latestSummary = "";
let latestTranscript = "";
let latestVideoMeta = {};
let sessionLogs = [];
let toastTimer;

// Configure Marked for robust GFM table and code block rendering
if (window.marked) {
  marked.setOptions({
    gfm: true,
    breaks: true
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function showError(message) {
  errorMessage.textContent = message;
  errorBox.classList.remove("hidden");
  errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function appendTerminalLog(time, level, text) {
  const line = document.createElement("div");
  line.className = `terminal-line ${level || "info"}`;
  
  const timeSpan = document.createElement("span");
  timeSpan.className = "terminal-time";
  timeSpan.textContent = `[${time || new Date().toLocaleTimeString()}]`;
  
  const textSpan = document.createElement("span");
  textSpan.className = "terminal-msg";
  textSpan.textContent = ` ${text}`;
  
  line.appendChild(timeSpan);
  line.appendChild(textSpan);
  terminalStream.appendChild(line);
  
  // Keep last 60 lines max and autoscroll
  while (terminalStream.children.length > 60) {
    terminalStream.removeChild(terminalStream.firstChild);
  }
  terminalStream.scrollTop = terminalStream.scrollHeight;
  sessionLogs.push({ time, level, text });

  const logCount = document.querySelector("#log-count");
  if (logCount) {
    logCount.textContent = `${sessionLogs.length} updates`;
  }
}

function updatePipelineStep(stepId, status) {
  const stepEl = document.querySelector(`#step-${stepId}`);
  if (!stepEl) return;
  stepEl.setAttribute("data-status", status); // 'idle', 'active', 'done'
}

function setPipelineProgress(stepName, percent, title, detail) {
  if (percent !== undefined && percent !== null) {
    const clamped = Math.min(100, Math.max(0, percent));
    progressPercent.textContent = `${clamped}%`;
    progressBarFill.style.width = `${clamped}%`;
  }
  if (title) progressTitle.textContent = title;
  if (detail) progressDetail.textContent = detail;
  if (terminalStepBadge && stepName) {
    terminalStepBadge.textContent = stepName.toUpperCase();
  }

  // Friendly 4-step flow
  const steps = ["validate", "transcript", "ai", "synthesis"];
  const stepMap = {
    "validate": 0,
    "transcript": 1,
    "chunking": 1,
    "ai_chunk": 2,
    "ai_process": 2,
    "pacing": 2,
    "synthesis": 3,
    "complete": 4
  };

  const currentIndex = stepMap[stepName] !== undefined ? stepMap[stepName] : -1;
  steps.forEach((s, idx) => {
    if (idx < currentIndex) {
      updatePipelineStep(s, "done");
    } else if (idx === currentIndex) {
      updatePipelineStep(s, "active");
    } else {
      updatePipelineStep(s, "idle");
    }
  });

  // Update connectors
  for (let i = 1; i <= 3; i++) {
    const conn = document.querySelector(`#conn-${i}`);
    if (conn) {
      conn.classList.toggle("filled", i <= currentIndex);
    }
  }
}

function setPipelineError(errorMsg) {
  progressTitle.textContent = "Analysis paused";
  progressDetail.textContent = errorMsg || "A service limit or temporary issue was reached. Tap Summarize to retry.";
  const kicker = document.querySelector("#progress-kicker");
  if (kicker) kicker.textContent = "PROCESS PAUSED";

  const activeStep = document.querySelector(".step-item[data-status='active']");
  if (activeStep) {
    activeStep.setAttribute("data-status", "error");
  }

  const pulseCore = document.querySelector(".pulse-core");
  if (pulseCore) pulseCore.style.background = "#f87171";
  const pulseRing = document.querySelector(".pulse-ring");
  if (pulseRing) pulseRing.style.display = "none";
}

function setBusy(busy) {
  submitButton.disabled = busy;
  submitButton.querySelector("span").textContent = busy ? "Analyzing…" : "Summarize";
  submitButton.querySelector("svg").classList.toggle("hidden", busy);

  if (busy) {
    progress.classList.remove("hidden");
    errorBox.classList.add("hidden");
    result.classList.add("hidden");
    pacingCountdownChip.classList.add("hidden");
    failoverNoticeChip.classList.add("hidden");
    terminalStream.innerHTML = "";
    sessionLogs = [];
    const pulseCore = document.querySelector(".pulse-core");
    if (pulseCore) pulseCore.style.background = "#a78bfa";
    const pulseRing = document.querySelector(".pulse-ring");
    if (pulseRing) pulseRing.style.display = "";
    const kicker = document.querySelector("#progress-kicker");
    if (kicker) kicker.textContent = "LIVE PROGRESS";
    setPipelineProgress("validate", 5, "Checking video link…", "Finding subtitles and preparing analysis.");
  }
}

// Render Markdown using Marked & DOMPurify with table responsiveness
function renderExecutiveMarkdown(markdownText) {
  if (!markdownText) return "";
  let html = "";
  if (window.marked && window.DOMPurify) {
    html = DOMPurify.sanitize(marked.parse(markdownText));
  } else {
    // Fallback if marked not ready
    html = markdownText.replace(/\n/g, "<br>");
  }

  // Wrap any tables in table-wrapper for smooth scrolling on mobile
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  const tables = tempDiv.querySelectorAll("table");
  tables.forEach((table) => {
    if (!table.parentElement.classList.contains("table-wrapper")) {
      const wrapper = document.createElement("div");
      wrapper.className = "table-wrapper";
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  });
  return tempDiv.innerHTML;
}

// Main Submit Handler with SSE Streaming Pipeline
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = document.querySelector("#video-url").value.trim();
  if (!url) return;

  setBusy(true);
  let requestCompleted = false;
  let receivedAnyEvent = false;
  appendTerminalLog(new Date().toLocaleTimeString(), "info", `Client initiated summarize request for ${url}`);

  try {
    const response = await fetch("/api/summarize?stream=1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify({
        url,
        style: document.querySelector("#summary-style").value,
        language: document.querySelector("#summary-language").value,
        stream: true
      })
    });

    if (!response.ok && !response.headers.get("content-type")?.includes("text/event-stream")) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server returned HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop(); // Retain incomplete frame

      for (const part of parts) {
        if (!part.trim()) continue;

        let eventType = "message";
        let dataStr = "";
        const lines = part.split("\n");

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataStr = line.slice(5).trim();
          }
        }

        if (dataStr) {
          try {
            const data = JSON.parse(dataStr);
            receivedAnyEvent = true;
            if (eventType === "complete") {
              requestCompleted = true;
            }
            handleStreamEvent(eventType, data, url);
          } catch (e) {
            console.error("SSE parse error:", e, dataStr);
          }
        }
      }
    }

    if (!requestCompleted) {
      throw new Error("The process stream closed unexpectedly. Check the execution log for details.");
    }
  } catch (err) {
    setPipelineError(err.message);
    showError(err.message || "Failed to process video. Please verify link and try again.");
    appendTerminalLog(new Date().toLocaleTimeString(), "error", err.message);
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Summarize";
    submitButton.querySelector("svg").classList.remove("hidden");
    if (requestCompleted) {
      progress.classList.add("hidden");
    }
  }
});

function handleStreamEvent(type, data, rawUrl) {
  switch (type) {
    case "status":
      setPipelineProgress(data.step, data.progress, data.title, data.detail);
      if (data.currentChunk && data.totalChunks > 1) {
        const stepAiLabel = document.querySelector("#step-ai-label");
        if (stepAiLabel) stepAiLabel.textContent = `Section ${data.currentChunk}/${data.totalChunks}`;
      }
      break;

    case "log":
      appendTerminalLog(data.time, data.level, data.text);
      break;

    case "video":
      latestVideoMeta = data;
      document.querySelector("#video-title").textContent = data.title || "YouTube video";
      document.querySelector("#video-channel").textContent = data.channel || "";
      document.querySelector("#video-duration").textContent = data.duration ? `Duration: ${data.duration}` : "";
      document.querySelector("#video-language").textContent = data.language ? `Captions: ${data.language}` : "";
      document.querySelector("#video-thumbnail").src = data.thumbnail || "";
      document.querySelector("#open-video").href = data.url || rawUrl;
      break;

    case "provider_active":
      if (activeEngineText) {
        activeEngineText.textContent = `⚡ AI Model: ${data.provider}`;
      }
      break;

    case "provider_failover":
      if (failoverNoticeChip) {
        failoverNoticeChip.classList.remove("hidden");
        failoverNoticeText.textContent = `⚡ Switched to backup model for speed`;
      }
      break;

    case "pacing_tick":
      if (pacingCountdownChip) {
        pacingCountdownChip.classList.remove("hidden");
        pacingCountdownText.textContent = `⏳ Reading section ${data.currentChunk} of ${data.totalChunks}… (${data.remaining}s)`;
      }
      break;

    case "complete":
      latestSummary = data.summary || "";
      latestTranscript = data.transcript || "";
      renderFinalResults(data, rawUrl);
      break;

    case "error":
      setPipelineError(data.error);
      showError(data.error || "An error occurred during summarization.");
      break;
  }
}

function renderFinalResults(data, rawUrl) {
  // Hide pacing chips
  pacingCountdownChip.classList.add("hidden");

  // Summary presentation
  const summaryContentEl = document.querySelector("#summary-content");
  summaryContentEl.innerHTML = renderExecutiveMarkdown(data.summary);

  // Transcript view
  document.querySelector("#transcript-content").textContent = data.transcript || "";
  document.querySelector("#transcript-count").textContent = `${(data.transcriptChars || 0).toLocaleString()} characters extracted`;

  // Badges & metrics calculation
  const wordCount = (data.summary || "").trim().split(/\s+/).filter(Boolean).length;
  const readMins = Math.max(1, Math.round(wordCount / 200));

  document.querySelector("#read-time-tag").textContent = `⏱️ ${readMins} min read`;
  document.querySelector("#words-count-tag").textContent = `📊 ${wordCount.toLocaleString()} words`;
  document.querySelector("#engine-tag").textContent = `⚡ ${data.providerUsed || "Cerebras"}`;
  document.querySelector("#chunk-badge").textContent = data.chunksUsed > 1 ? `${data.chunksUsed} parts combined` : "Single pass";
  
  if (data.durationMs) {
    document.querySelector("#summary-duration-badge").textContent = `Completed in ${(data.durationMs / 1000).toFixed(1)}s`;
  }

  // Populate Tab 3: Execution Stats & Session Replay
  document.querySelector("#stat-total-time").textContent = `${((data.durationMs || 0) / 1000).toFixed(1)}s`;
  document.querySelector("#stat-provider").textContent = data.providerUsed || "Cerebras / Groq";
  document.querySelector("#stat-chars").textContent = (data.transcriptChars || 0).toLocaleString();
  document.querySelector("#stat-chunks").textContent = `${data.chunksUsed || 1} chunk(s)`;

  const replayContainer = document.querySelector("#session-log-replay");
  replayContainer.innerHTML = "";
  sessionLogs.forEach((log) => {
    const row = document.createElement("div");
    row.className = `replay-log-item ${log.level || "info"}`;
    row.innerHTML = `<span class="replay-time">${log.time}</span> <span class="replay-msg">${log.text}</span>`;
    replayContainer.appendChild(row);
  });

  // Switch to Summary Tab
  switchTab("view-summary");

  // Reveal results
  result.classList.remove("hidden");
  result.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Executive summary generated successfully!");
}

// Tab Switching Logic
function switchTab(targetId) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-target") === targetId);
  });
  document.querySelectorAll(".tab-view").forEach((view) => {
    if (view.id === targetId) {
      view.classList.remove("hidden");
      view.classList.add("active");
    } else {
      view.classList.add("hidden");
      view.classList.remove("active");
    }
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.getAttribute("data-target"));
  });
});

// UI Actions
document.querySelector("#dismiss-error").addEventListener("click", () => {
  errorBox.classList.add("hidden");
});

document.querySelector("#copy-summary").addEventListener("click", async () => {
  if (!latestSummary) return;
  try {
    await navigator.clipboard.writeText(latestSummary);
    showToast("Summary copied in Markdown format.");
  } catch {
    showToast("Clipboard access failed. Please select text manually.");
  }
});

document.querySelector("#copy-transcript").addEventListener("click", async () => {
  if (!latestTranscript) return;
  try {
    await navigator.clipboard.writeText(latestTranscript);
    showToast("Full transcript copied.");
  } catch {
    showToast("Clipboard access failed.");
  }
});

document.querySelector("#download-md").addEventListener("click", () => {
  if (!latestSummary) return;
  const title = latestVideoMeta.title || "youtube-summary";
  const content = `# ${title}\n\n*Source: ${latestVideoMeta.url || ""}*\n*Channel: ${latestVideoMeta.channel || ""}*\n\n---\n\n${latestSummary}\n\n---\n*Generated by YT Summary Studio with rate-limit aware AI cascade.*`;
  
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[^\w\d -]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "youtube-summary"}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Exported as Markdown (.md)");
});

document.querySelector("#download-summary").addEventListener("click", () => {
  if (!latestSummary) return;
  const title = latestVideoMeta.title || "youtube-summary";
  const content = `${title}\n${"=".repeat(Math.min(title.length, 75))}\nSource: ${latestVideoMeta.url || ""}\nChannel: ${latestVideoMeta.channel || ""}\n\n${latestSummary}\n\nGenerated by YT Summary Studio.\n`;
  
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[^\w\d -]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "youtube-summary"}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Exported as Plain Text (.txt)");
});

// Initial Health Check on page load
async function checkServerHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data.ok) {
      const topbarStatus = document.querySelector("#topbar-provider-label");
      if (topbarStatus) {
        topbarStatus.textContent = `Cascade: ${data.primaryProvider.toUpperCase()} ➔ Fallbacks Active`;
      }
    }
  } catch (e) {
    console.warn("Health check unavailable:", e);
  }
}
checkServerHealth();
