# Notely

A complete, responsive YouTube transcript summarizer and AI study studio. It retrieves captions through TranscriptAPI.com, tries Cerebras first, and falls back to Groq and Gemini with rate-limit-aware provider cooldowns and live process streaming.

## Features

- Paste a YouTube URL and fetch its transcript.
- Quick summary, detailed breakdown, study notes, or action items.
- Output language selection.
- Long-transcript chunking (conservative 5,500-character chunks to reduce Groq TPM/request-size errors) and combined summaries.
- Video metadata/thumbnail when provided by the transcript service.
- View/copy transcript, copy summary, and export summary to `.txt`.
- API keys stay on the server in `.env`; they are not shipped to the browser.

## Requirements

- Node.js 18 or newer
- A TranscriptAPI.com API key
- A Cerebras API key (primary provider)
- Optional Groq API key (fallback 1)
- Optional Google AI Studio Gemini API key (fallback 2)

Provider order is Cerebras → Groq → Gemini. Rate-limited providers are put into cooldown and skipped for subsequent chunks, rather than being hammered repeatedly. The app waits between transcript chunks (default 10 seconds) to reduce requests-per-minute spikes. Set `AI_CHUNK_DELAY_MS` in `.env` to change the delay. Providers still enforce account-specific quotas and availability. Cerebras defaults to `gpt-oss-120b`; Groq defaults to `openai/gpt-oss-120b`; Gemini uses the Interactions API and defaults to `gemini-3.8-flash`.

## Run locally (Windows PowerShell)

1. Extract the ZIP and open the folder in VS Code.
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Create `.env` from the example:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Open `.env` and add your own keys:

   ```env
   TRANSCRIPT_API_KEY=your_transcriptapi_key
   GROQ_API_KEY=your_groq_api_key
   GROQ_MODEL=openai/gpt-oss-120b
   GEMINI_API_KEY=your_gemini_api_key
   GEMINI_MODEL=gemini-3.8-flash
   PORT=3000
   ```

5. Start the server:

   ```powershell
   npm start
   ```

6. Open http://localhost:3000

For development with automatic server restarts, use `npm run dev`.

## Important: rotate the keys you shared

API keys were posted in chat. Treat them as exposed:
- Revoke/delete the Cerebras key shared in chat and create a replacement.
- Revoke/delete any other API keys previously shared in chat (including Gemini and TranscriptAPI) and create replacements.
- Put only the replacement keys in your local `.env`. Never commit `.env` or paste the keys into public code.

## Deployment

Deploy this as a Node.js web service that supports Express (for example, a suitable Render/Railway/Fly.io service). Set `TRANSCRIPT_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, and optionally `CEREBRAS_MODEL` / `GROQ_MODEL` / `GEMINI_MODEL` as server-side environment variables in the host's dashboard. Do not put secrets in frontend environment variables. Free hosting tiers may sleep, have quotas, or change.

## API

`POST /api/summarize`

JSON body:

```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "style": "concise",
  "language": "Same as transcript"
}
```

Allowed styles: `concise`, `detailed`, `study`, `action`.

`GET /api/health` returns whether the server has required keys configured (it never returns the keys themselves).

## Troubleshooting

- **Missing key:** Ensure `.env` exists in the project root. Add `TRANSCRIPT_API_KEY` and at least one AI key; for automatic failover, configure multiple provider keys.
- **401 / invalid key:** Rotate and replace the key in `.env`.
- **Transcript 402:** Your TranscriptAPI account may have no credits/active plan.
- **Transcript 404:** Captions may not exist or the video may be unavailable.
- **Groq error:** Check your Groq API key, active model ID, and account limits. The app puts the provider into cooldown and tries the next configured provider. It will skip that provider for later chunks while the cooldown remains active.
- **Gemini quota/high-demand error:** Check your AI Studio usage/limits or choose an available model in `GEMINI_MODEL`. Gemini is the last fallback. A daily quota error is not retried repeatedly; the provider is put into cooldown. If all providers are rate-limited, the request can still fail.
- **Long videos:** The app splits transcripts into conservative 5,500-character chunks, summarizes each chunk with a smaller intermediate output, then combines the results. This avoids the oversized ~18,000-character Groq prompts that triggered HTTP 413 on an 8,000 TPM tier. Groq can still return HTTP 429 if the account’s per-minute quota is exhausted; the app then falls back to Gemini.
- **CORS:** Browser calls go to this app's own backend, so provider keys are not exposed and cross-origin provider calls are avoided.

## Terminal logs and Gemini high-demand errors

Run the app from a terminal with `npm start` (or `npm run dev`). Keep that terminal open: each summarize request logs transcript fetching, transcript size, chunk progress, provider attempts, provider switches, HTTP status, cooldown expiry, inter-chunk pacing, and total duration. API keys are never printed.

Cerebras is the primary provider, followed by Groq and Gemini. HTTP 429/rate-limit errors trigger provider cooldowns; daily-quota errors are not pointlessly retried. The default 10-second gap between chunks helps reduce request bursts. This cannot bypass provider quotas or guarantee success if all providers are unavailable.

If you see a persistent error, copy the relevant terminal lines starting at `Summarize request received` through `Summarize request failed` and share them **after removing any private video URL or other sensitive details**. Never share your `.env` file or API keys.
