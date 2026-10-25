require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TRANSCRIPT_API_KEY = process.env.TRANSCRIPT_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "gpt-oss-120b";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
// Keep providers that are rate-limited out of rotation until their cooldown expires.
const providerCooldowns = new Map();
function parseRetryMs(message, headers) {
  const retryAfter = Number(headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 24 * 60 * 60 * 1000);
  const text = String(message || "");
  let match = text.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.max(5000, Math.ceil(Number(match[1]) * 1000) + 1000);
  match = text.match(/retry in\s+(\d+)h(\d+)m(\d+)s/i);
  if (match) return ((Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3])) * 1000;
  if (/per day|daily limit|requests per day|quota.*exceeded/i.test(text)) return 12 * 60 * 60 * 1000;
  if (/requests per minute|rate limit|tokens per minute|tpm/i.test(text)) return 60 * 1000;
  return 30 * 1000;
}
function cooldownProvider(name, ms, reason, onProgress) {
  const wait = Math.max(5000, ms);
  const until = Date.now() + wait;
  providerCooldowns.set(name, until);
  log("warn", `Provider cooldown enabled`, `provider=${name}, until=${new Date(until).toISOString()}, waitMs=${wait}, reason=${String(reason || "rate limit").slice(0, 180)}`);
  onProgress?.({
    event: "cooldown",
    provider: name,
    waitMs: wait,
    until,
    reason: String(reason || "rate limit").slice(0, 180)
  });
}
function providerIsCoolingDown(name) {
  const until = providerCooldowns.get(name) || 0;
  if (until <= Date.now()) { providerCooldowns.delete(name); return false; }
  return true;
}
function getProviderModel(name) {
  if (name === "Cerebras") return CEREBRAS_MODEL;
  if (name === "Groq") return GROQ_MODEL;
  if (name === "Gemini") return GEMINI_MODEL;
  return "default";
}
function log(level, message, details = "") {
  const suffix = details ? ` | ${details}` : "";
  console[level](`[${now()}] [${level.toUpperCase()}] ${message}${suffix}`);
}
function safeErrorMessage(data, status) {
  return data?.error?.message || data?.detail || data?.message || `HTTP ${status}`;
}

function cleanYouTubeUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Paste a YouTube video URL first.");
  // Permit standard YouTube URLs and youtu.be short links only.
  let url;
  try { url = new URL(raw); } catch { throw new Error("That doesn't look like a valid URL."); }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) {
    throw new Error("Please enter a YouTube video URL.");
  }
  return raw;
}

async function getTranscript(videoUrl) {
  if (!TRANSCRIPT_API_KEY) {
    const err = new Error("TranscriptAPI key is missing. Add TRANSCRIPT_API_KEY to your .env file.");
    err.status = 500; throw err;
  }
  const params = new URLSearchParams({
    video_url: videoUrl,
    format: "json",
    include_timestamp: "true",
    send_metadata: "true"
  });
  const response = await fetch(`https://transcriptapi.com/api/v2/youtube/transcript?${params}`, {
    headers: {
      Authorization: `Bearer ${TRANSCRIPT_API_KEY}`,
      "User-Agent": "YT-Summary-Studio/1.0"
    },
    signal: AbortSignal.timeout(60000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.detail || data.message || data.error || `Transcript service returned HTTP ${response.status}.`;
    const err = new Error(message);
    err.status = response.status === 401 || response.status === 402 ? 502 : response.status;
    throw err;
  }

  const segments = Array.isArray(data.transcript) ? data.transcript : [];
  const transcriptText = segments.map((segment) => {
    const text = String(segment.text || "").trim();
    if (!text) return "";
    const start = Number(segment.start);
    const stamp = Number.isFinite(start) ? `[${formatTimestamp(start)}] ` : "";
    return `${stamp}${text}`;
  }).filter(Boolean).join("\n");

  if (!transcriptText.trim()) throw new Error("No transcript text was returned for this video.");
  return {
    videoId: data.video_id || extractVideoId(videoUrl),
    language: data.language || "Unknown",
    duration: data.lengthText || (data.length_seconds ? formatTimestamp(data.length_seconds) : ""),
    title: data.metadata?.title || data.title || "YouTube video",
    channel: data.metadata?.author_name || data.metadata?.channel_name || "",
    thumbnail: data.metadata?.thumbnail_url || `https://i.ytimg.com/vi/${extractVideoId(videoUrl)}/hqdefault.jpg`,
    segments,
    transcriptText
  };
}

function extractVideoId(input) {
  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) return url.pathname.split("/").filter(Boolean)[0] || "";
    return url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop() || "";
  } catch { return input; }
}

function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// Keep prompts comfortably below Groq's common free/on-demand TPM request ceiling.
// 5,500 characters is deliberately conservative for multilingual/Hindi transcripts.
function splitTranscript(text, maxChars = 5500) {
  const lines = text.split("\n");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current) {
      chunks.push(current);
      current = "";
    }
    // Split a single exceptionally long line safely.
    if (line.length > maxChars) {
      if (current) { chunks.push(current); current = ""; }
      for (let i = 0; i < line.length; i += maxChars) chunks.push(line.slice(i, i + maxChars));
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function geminiGenerate(prompt, maxOutputTokens = 1800, context = "summary") {
  if (!GEMINI_API_KEY) {
    const err = new Error("Gemini API key is missing. Add GEMINI_API_KEY to your .env file.");
    err.status = 500; throw err;
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const maxAttempts = 4;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    log("log", `Gemini request started (${context})`, `model=${GEMINI_MODEL}, attempt=${attempt}/${maxAttempts}, promptChars=${prompt.length}`);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          input: prompt,
          store: false,
          generation_config: { max_output_tokens: maxOutputTokens, temperature: 0.3 }
        }),
        signal: AbortSignal.timeout(120000)
      });
      const data = await response.json().catch(() => ({}));
      const elapsed = Date.now() - started;

      if (response.ok) {
        const outputText = typeof data.output_text === "string" ? data.output_text : "";
        const stepText = (data.steps || [])
          .filter(step => step.type === "model_output")
          .flatMap(step => Array.isArray(step.content) ? step.content : [])
          .filter(part => part.type === "text" || typeof part.text === "string")
          .map(part => part.text || "")
          .join("");
        const text = (outputText || stepText).trim();
        if (text) {
          log("log", `Gemini request succeeded (${context})`, `attempt=${attempt}, elapsedMs=${elapsed}, outputChars=${text.length}`);
          return text;
        }
        const err = new Error("Gemini returned an empty response. Try again or choose a shorter summary.");
        err.status = 502;
        log("error", `Gemini returned an empty response (${context})`, `elapsedMs=${elapsed}, responseKeys=${Object.keys(data).join(",")}`);
        throw err;
      }

      const message = safeErrorMessage(data, response.status);
      lastError = new Error(message);
      lastError.status = response.status;
      const dailyQuota = /per day|daily limit|requests per day|retry in \d+h\d+m/i.test(message);
      const transient = !dailyQuota && [408, 500, 502, 503, 504].includes(response.status)
        || (!dailyQuota && response.status === 429 && /high demand|temporar|overload/i.test(message));
      log(transient && attempt < maxAttempts ? "warn" : "error", `Gemini request failed (${context})`, `http=${response.status}, attempt=${attempt}/${maxAttempts}, elapsedMs=${elapsed}, message=${message}`);

      if (!transient || attempt === maxAttempts) break;
      const delay = Math.min(parseRetryMs(message, response.headers), 30000);
      log("warn", `Gemini is temporarily busy; retrying (${context})`, `waitMs=${delay}`);
      await sleep(delay);
    } catch (error) {
      if (error.status) throw error;
      lastError = error;
      const transient = error.name === "TimeoutError" || error.name === "AbortError" || error.name === "TypeError";
      log(transient && attempt < maxAttempts ? "warn" : "error", `Gemini network error (${context})`, `attempt=${attempt}/${maxAttempts}, message=${error.message}`);
      if (!transient || attempt === maxAttempts) break;
      const delay = Math.min(2000 * (2 ** (attempt - 1)), 15000);
      log("warn", `Retrying Gemini after network error (${context})`, `waitMs=${delay}`);
      await sleep(delay);
    }
  }

  if (lastError) {
    if (!lastError.status) lastError.status = 503;
    if (/high demand|temporar|overload|try again later/i.test(lastError.message) && lastError.status !== 429) {
      lastError.message = `Gemini is temporarily overloaded. Details: ${lastError.message}`;
      lastError.status = 503;
    }
    throw lastError;
  }
  const err = new Error("Gemini request failed without returning a response.");
  err.status = 503;
  throw err;
}

async function cerebrasGenerate(prompt, maxOutputTokens = 1800, context = "summary") {
  if (!CEREBRAS_API_KEY) {
    const err = new Error("Cerebras API key is missing. Add CEREBRAS_API_KEY to your .env file.");
    err.status = 500;
    throw err;
  }
  const started = Date.now();
  log("log", `Cerebras request started (${context})`, `model=${CEREBRAS_MODEL}, promptChars=${prompt.length}`);
  const response = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CEREBRAS_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      messages: [
        { role: "system", content: "You are a careful YouTube transcript summarizer. Use only information supported by the supplied transcript. Do not invent facts." },
        { role: "user", content: prompt }
      ],
      max_completion_tokens: maxOutputTokens,
      temperature: 0.3
    }),
    signal: AbortSignal.timeout(90000)
  });
  const data = await response.json().catch(() => ({}));
  const elapsed = Date.now() - started;
  if (!response.ok) {
    const message = safeErrorMessage(data, response.status);
    const err = new Error(message);
    err.status = response.status;
    log("warn", `Cerebras request failed (${context})`, `http=${response.status}, elapsedMs=${elapsed}, message=${message}`);
    throw err;
  }
  const text = String(data.choices?.[0]?.message?.content || "").trim();
  if (!text) {
    const err = new Error("Cerebras returned an empty response.");
    err.status = 502;
    log("warn", `Cerebras returned empty response (${context})`, `elapsedMs=${elapsed}`);
    throw err;
  }
  log("log", `Cerebras request succeeded (${context})`, `elapsedMs=${elapsed}, outputChars=${text.length}`);
  return text;
}

async function groqGenerate(prompt, maxOutputTokens = 1800, context = "summary") {
  if (!GROQ_API_KEY) {
    const err = new Error("Groq API key is missing. Add GROQ_API_KEY to your .env file.");
    err.status = 500;
    throw err;
  }
  const started = Date.now();
  log("log", `Groq request started (${context})`, `model=${GROQ_MODEL}, promptChars=${prompt.length}`);
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: "You are a careful YouTube transcript summarizer. Use only information supported by the supplied transcript. Do not invent facts." },
        { role: "user", content: prompt }
      ],
      max_completion_tokens: maxOutputTokens,
      temperature: 0.3
    }),
    signal: AbortSignal.timeout(90000)
  });
  const data = await response.json().catch(() => ({}));
  const elapsed = Date.now() - started;
  if (!response.ok) {
    const message = safeErrorMessage(data, response.status);
    const err = new Error(message);
    err.status = response.status;
    log("warn", `Groq request failed (${context})`, `http=${response.status}, elapsedMs=${elapsed}, message=${message}`);
    throw err;
  }
  const text = String(data.choices?.[0]?.message?.content || "").trim();
  if (!text) {
    const err = new Error("Groq returned an empty response.");
    err.status = 502;
    log("warn", `Groq returned empty response (${context})`, `elapsedMs=${elapsed}`);
    throw err;
  }
  log("log", `Groq request succeeded (${context})`, `elapsedMs=${elapsed}, outputChars=${text.length}`);
  return text;
}

// Provider order: Cerebras -> Groq -> Gemini. Rate-limited providers are temporarily skipped.
async function aiGenerate(prompt, maxOutputTokens = 1800, context = "summary", onProgress = null) {
  const providers = [];
  if (CEREBRAS_API_KEY) providers.push(["Cerebras", cerebrasGenerate]);
  if (GROQ_API_KEY) providers.push(["Groq", groqGenerate]);
  if (GEMINI_API_KEY) providers.push(["Gemini", geminiGenerate]);

  if (!providers.length) {
    const err = new Error("No AI provider is configured. Add CEREBRAS_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY to .env.");
    err.status = 500;
    throw err;
  }

  let lastError;
  let attempted = 0;
  for (let idx = 0; idx < providers.length; idx++) {
    const [name, generate] = providers[idx];
    if (providerIsCoolingDown(name)) {
      log("warn", `Skipping provider in cooldown (${context})`, `provider=${name}`);
      continue;
    }
    attempted++;
    const model = getProviderModel(name);
    onProgress?.({
      event: "attempt",
      provider: name,
      model,
      context
    });
    const startTime = Date.now();
    try {
      const result = await generate(prompt, maxOutputTokens, context);
      const elapsedMs = Date.now() - startTime;
      onProgress?.({
        event: "success",
        provider: name,
        model,
        elapsedMs
      });
      return { text: result, provider: name, model, elapsedMs };
    } catch (error) {
      lastError = error;
      const message = error.message || "Unknown error";
      const status = Number(error.status) || 0;
      log("warn", `AI provider failed (${context})`, `provider=${name}, http=${status || "network"}, message=${message}`);
      
      let waitMs = 30000;
      if (status === 429 || /rate limit|requests per minute|tokens per minute|per day|daily limit|quota.*exceeded/i.test(message)) {
        waitMs = parseRetryMs(message);
        cooldownProvider(name, waitMs, message, onProgress);
      } else if ([502, 503, 504].includes(status) || /high demand|overload|temporarily unavailable/i.test(message)) {
        waitMs = 30000;
        cooldownProvider(name, waitMs, message, onProgress);
      }

      const nextAvailable = providers.slice(idx + 1).find(([pName]) => !providerIsCoolingDown(pName));
      onProgress?.({
        event: "failover",
        fromProvider: name,
        toProvider: nextAvailable ? nextAvailable[0] : null,
        status,
        waitMs,
        reason: message
      });
    }
  }
  const err = new Error(attempted === 0
    ? "All configured AI providers are currently rate-limited. Wait for the provider cooldowns to expire, then retry. Check the terminal for cooldown times."
    : `All available AI providers failed. Last error: ${lastError?.message || "Unknown error"}`);
  err.status = lastError?.status || 503;
  throw err;
}

function makeSummaryPrompt(transcript, style, language) {
  const styles = {
    concise: "Write a concise summary in 5-8 bullet points, followed by a bold one-sentence TL;DR.",
    detailed: "Write a detailed, well-structured summary with clear section headings (##), important explanations, examples, and a final takeaway. When presenting key people, entities, or comparison points, format them in clean GitHub-flavored Markdown tables with header rows.",
    study: "Create useful, comprehensive study notes with clear section headings (##), Key Concepts, Important Names & Entities (format as a clean Markdown table with columns: | Name / Entity | Role & Significance | Context |), Core Definitions, and 8-12 revision bullets where appropriate.",
    action: "Extract the main ideas, practical steps, recommendations, and any action items. Present actionable advice in a clean sequential or checklist structure, separating explicit advice from interpretation."
  };
  return `You are a careful, professional YouTube transcript summarizer. Summarize only what is supported by the transcript. Do not invent facts, quotes, timestamps, or claims. If the transcript is unclear or incomplete, say so briefly. Preserve important names, numbers, and technical terms. Use beautiful, standard GitHub-flavored Markdown. Ensure any Markdown tables have standard header rows and delimiter lines (|---|---|) on their own lines. ${styles[style] || styles.concise}
Output language: ${language || "same language as the transcript"}.

TRANSCRIPT:
${transcript}`;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: { transcriptApi: Boolean(TRANSCRIPT_API_KEY), cerebras: Boolean(CEREBRAS_API_KEY), groq: Boolean(GROQ_API_KEY), gemini: Boolean(GEMINI_API_KEY) },
    primaryProvider: CEREBRAS_API_KEY ? "cerebras" : GROQ_API_KEY ? "groq" : "gemini",
    cerebrasModel: CEREBRAS_MODEL,
    groqModel: GROQ_MODEL,
    geminiModel: GEMINI_MODEL
  });
});

app.post("/api/summarize", async (req, res) => {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const requestStarted = Date.now();
  const isStream = req.query.stream === "1" || req.headers.accept?.includes("text/event-stream") || req.body?.stream === true;

  let isClientAborted = false;
  if (isStream) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.on("close", () => {
      if (!res.writableEnded) {
        isClientAborted = true;
      }
    });
  }

  const sendEvent = (event, data) => {
    if (!isStream || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === "function") res.flush();
    } catch (e) {
      log("warn", `Could not send SSE event ${event}`, e.message);
    }
  };

  const emitLog = (level, text) => {
    log(level === "error" ? "error" : level === "warn" ? "warn" : "log", text, `id=${requestId}`);
    sendEvent("log", {
      time: new Date().toLocaleTimeString(),
      level,
      text
    });
  };

  const videoUrl = String(req.body?.url || "").trim();
  log("log", `Summarize request received`, `id=${requestId}, stream=${isStream}, url=${videoUrl || "(empty)"}`);

  try {
    sendEvent("status", {
      step: "validate",
      title: "Checking video link",
      detail: "Confirming the YouTube address is valid...",
      progress: 5
    });
    emitLog("info", "Checking YouTube video link...");

    const cleanUrl = cleanYouTubeUrl(videoUrl);
    const style = ["concise", "detailed", "study", "action"].includes(req.body?.style) ? req.body.style : "concise";
    const language = String(req.body?.language || "Same as transcript").slice(0, 60);

    sendEvent("status", {
      step: "transcript",
      title: "Finding video subtitles",
      detail: "Fetching speech transcript and captions...",
      progress: 15
    });
    emitLog("info", "Loading subtitles and video details...");

    const transcript = await getTranscript(cleanUrl);
    emitLog("success", `Subtitles loaded: ${transcript.transcriptText.length.toLocaleString()} characters of speech`);

    sendEvent("video", {
      videoId: transcript.videoId,
      title: transcript.title,
      channel: transcript.channel,
      duration: transcript.duration,
      language: transcript.language,
      thumbnail: transcript.thumbnail,
      transcriptChars: transcript.transcriptText.length,
      url: cleanUrl
    });

    const chunks = splitTranscript(transcript.transcriptText);
    sendEvent("status", {
      step: "chunking",
      title: chunks.length > 1 ? "Organizing video sections" : "Analyzing content",
      detail: chunks.length > 1
        ? `Long video detected: organizing into ${chunks.length} sections for maximum detail.`
        : "Video transcript loaded and ready for analysis.",
      progress: 25,
      totalChunks: chunks.length
    });
    emitLog("info", `Prepared ${chunks.length} section(s) to analyze in detail.`);

    let lastProviderUsed = "";
    const handleAiProgress = (p) => {
      if (p.event === "attempt") {
        emitLog("info", `AI is analyzing: ${p.context.replace(/request=[^,]+,\s*/, "")}...`);
        sendEvent("provider_active", { provider: p.provider, model: p.model });
      } else if (p.event === "success") {
        lastProviderUsed = `${p.provider}`;
        emitLog("success", `Section processed in ${(p.elapsedMs / 1000).toFixed(1)}s`);
      } else if (p.event === "failover") {
        emitLog("warn", `Switching to backup AI model to ensure fast response...`);
        sendEvent("provider_failover", { from: p.fromProvider, to: p.toProvider, waitMs: p.waitMs, reason: p.reason });
      } else if (p.event === "cooldown") {
        sendEvent("cooldown_notice", { provider: p.provider, waitMs: p.waitMs, until: p.until, reason: p.reason });
      }
    };

    let summary;

    if (chunks.length === 1) {
      sendEvent("status", {
        step: "ai_process",
        title: "Writing your notes",
        detail: `Extracting key takeaways and structuring your ${style} summary...`,
        progress: 50,
        currentChunk: 1,
        totalChunks: 1
      });
      const aiRes = await aiGenerate(makeSummaryPrompt(chunks[0], style, language), 1800, `request=${requestId}, final summary`, handleAiProgress);
      summary = aiRes.text;
    } else {
      const intermediate = [];
      for (let i = 0; i < chunks.length; i++) {
        if (isClientAborted || res.writableEnded) break;
        if (i > 0) {
          const gapMs = Number(process.env.AI_CHUNK_DELAY_MS || 10000);
          const gapSec = Math.round(gapMs / 1000);
          emitLog("info", `Preparing to read section ${i + 1} of ${chunks.length}...`);
          sendEvent("status", {
            step: "pacing",
            title: `Reading section ${i + 1} of ${chunks.length}`,
            detail: `Refining insights and preparing section ${i + 1}...`,
            progress: Math.round(25 + ((i) / chunks.length) * 55),
            waitSeconds: gapSec,
            currentChunk: i + 1,
            totalChunks: chunks.length
          });
          for (let s = gapSec; s > 0; s--) {
            if (isClientAborted || res.writableEnded) break;
            sendEvent("pacing_tick", { remaining: s, total: gapSec, currentChunk: i + 1, totalChunks: chunks.length });
            await sleep(1000);
          }
        }
        if (isClientAborted || res.writableEnded) break;

        sendEvent("status", {
          step: "ai_chunk",
          title: `Extracting insights (${i + 1} of ${chunks.length})`,
          detail: `Finding core points, definitions, and key arguments in section ${i + 1}...`,
          progress: Math.round(25 + ((i + 0.5) / chunks.length) * 55),
          currentChunk: i + 1,
          totalChunks: chunks.length
        });

        const chunkPrompt = `Summarize part ${i + 1} of ${chunks.length} of a YouTube transcript. Keep important facts, names, definitions, arguments, and timestamp markers. Do not add an introduction or conclusion that is not in this section. Use compact bullet points. This is an intermediate summary, not the final answer.\n\n${chunks[i]}`;
        const chunkRes = await aiGenerate(chunkPrompt, 800, `request=${requestId}, part ${i + 1}/${chunks.length}`, handleAiProgress);
        intermediate.push(chunkRes.text);
      }

      sendEvent("status", {
        step: "synthesis",
        title: "Assembling final summary",
        detail: "Formatting clear tables, organizing headings, and polishing notes...",
        progress: 92
      });
      emitLog("info", "Assembling final summary, tables, and key takeaways...");

      const finalPrompt = `Combine these partial summaries into one coherent final YouTube summary. Remove repetition, preserve key details, and do not invent facts. ${makeSummaryPrompt(intermediate.join("\n\n---\n\n"), style, language)}`;
      const finalRes = await aiGenerate(finalPrompt, 2400, `request=${requestId}, combine summaries`, handleAiProgress);
      summary = finalRes.text;
    }

    const durationMs = Date.now() - requestStarted;
    log("log", `Summarize request completed`, `id=${requestId}, elapsedMs=${durationMs}, summaryChars=${summary.length}`);

    const resultPayload = {
      ok: true,
      video: {
        videoId: transcript.videoId,
        title: transcript.title,
        channel: transcript.channel,
        duration: transcript.duration,
        language: transcript.language,
        thumbnail: transcript.thumbnail,
        url: cleanUrl
      },
      summary,
      transcript: transcript.transcriptText,
      transcriptChars: transcript.transcriptText.length,
      chunksUsed: chunks.length,
      providerUsed: lastProviderUsed,
      durationMs
    };

    if (isStream) {
      sendEvent("status", {
        step: "complete",
        title: "Your summary is ready!",
        detail: `Completed in ${(durationMs / 1000).toFixed(1)} seconds.`,
        progress: 100
      });
      emitLog("success", `Summary complete! Created in ${(durationMs / 1000).toFixed(1)}s`);
      sendEvent("complete", resultPayload);
      res.end();
    } else {
      res.json(resultPayload);
    }
  } catch (error) {
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
    const errorMsg = error.message || "Something went wrong. Please try again.";
    log("error", `Summarize request failed`, `id=${requestId}, http=${status}, elapsedMs=${Date.now() - requestStarted}, message=${errorMsg}`);

    if (isStream && !res.writableEnded) {
      sendEvent("log", { time: new Date().toLocaleTimeString(), level: "error", text: `Error: ${errorMsg}` });
      sendEvent("error", { error: errorMsg, requestId });
      res.end();
    } else if (!res.writableEnded) {
      res.status(status).json({ error: errorMsg, requestId });
    }
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

module.exports = app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    log("log", `Notely running at http://localhost:${PORT}`);
    log("log", `AI configuration`, `primary=${CEREBRAS_API_KEY ? `Cerebras (${CEREBRAS_MODEL})` : GROQ_API_KEY ? `Groq (${GROQ_MODEL})` : `Gemini (${GEMINI_MODEL})`}, cerebrasApiKey=${Boolean(CEREBRAS_API_KEY)}, groqApiKey=${Boolean(GROQ_API_KEY)}, geminiModel=${GEMINI_MODEL}, geminiApiKey=${Boolean(GEMINI_API_KEY)}, transcriptApiKey=${Boolean(TRANSCRIPT_API_KEY)}`);
    log("log", `Rate-limit pacing | chunkDelayMs=${Number(process.env.AI_CHUNK_DELAY_MS || 10000)}`);
    log("log", "Terminal logging enabled. Keep this terminal open to watch transcript and AI requests.");
    if (!TRANSCRIPT_API_KEY || (!CEREBRAS_API_KEY && !GROQ_API_KEY && !GEMINI_API_KEY)) {
      log("warn", "Configuration incomplete", "Add TRANSCRIPT_API_KEY and at least one AI provider key to .env. Recommended failover order: Cerebras, Groq, Gemini.");
    }
  });
}
