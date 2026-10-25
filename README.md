# Notely · Executive AI Video Notes & Summaries

> Crafted with precision by **[Ansh Yadav](https://github.com/Ansh-Yadav-maths-lover)**.

A sleek, responsive, and resilient YouTube transcript summarization engine and study workspace. Notely fetches video captions via TranscriptAPI, runs an intelligent adaptive cascade across Cerebras (`gpt-oss-120b`), Groq (`gpt-oss-120b` / `gpt-oss-20b`), and Gemini (`gemini-3.8-flash`), and streams live step-by-step progress straight to your screen.

---

## Highlights

- ⚡ **Adaptive Chunking Engine**: Dynamically balances long video transcripts (up to 100,000+ characters) into optimal sections, avoiding token starvation and rate-limit traps.
- 🛡️ **Rate-Limit Aware AI Cascade**: Automatic failover (Cerebras → Groq → Gemini) with circuit breakers, smart cooldown periods, and model switching (`120b` → `20b`) on Groq limits.
- 📡 **Real-Time SSE Streaming**: Live 4-step visual progress pipeline (*Link Checked → Subtitles Loaded → Key Ideas Extracted → Executive Summary Generated*).
- 📱 **Mobile & Desktop Responsive**: Fully optimized touch layout for smartphones and desktops alike, featuring thumb-friendly controls and smooth table swiping.
- 📊 **Rich Markdown & Data Visualizations**: Renders clean headings, key takeaways, and GFM comparison tables safely using marked & DOMPurify.
- 💾 **Instant Exports**: One-click copy or download formatted `.md` and `.txt` notes stamped with video metadata and creator signatures.

---

## Tech Stack

- **Backend**: Node.js, Express, Server-Sent Events (SSE)
- **Frontend**: Vanilla ES6+, CSS Modern Grid & Flexbox, Space Grotesk & DM Sans typography
- **Parsers**: Marked.js (GFM), DOMPurify
- **Deployment**: Vercel Serverless Ready (`vercel.json`) & Node.js hosts (Render, Railway, Fly.io)

---

## Quick Start (Local Setup)

### 1. Clone & Install

```powershell
git clone https://github.com/Ansh-Yadav-maths-lover/Notely.git
cd Notely
npm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
# Caption Service
TRANSCRIPT_API_KEY=your_transcriptapi_key

# Primary AI Provider (Fast reasoning)
CEREBRAS_API_KEY=your_cerebras_api_key
CEREBRAS_MODEL=gpt-oss-120b

# Secondary AI Provider (Fallback)
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-120b

# Tertiary Provider (Fallback 2)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash

# Inter-chunk pacing (milliseconds)
AI_CHUNK_DELAY_MS=3000
PORT=3000
```

### 3. Run

```powershell
npm start
```
Visit `http://localhost:3000` in your browser.

---

## Deployment on Vercel

Notely is configured for one-click deployment on [Vercel](https://vercel.com):

1. Import your GitHub repository `https://github.com/Ansh-Yadav-maths-lover/Notely` into Vercel.
2. In **Project Settings** → **Environment Variables**, add:
   - `TRANSCRIPT_API_KEY`
   - `CEREBRAS_API_KEY`
   - `GROQ_API_KEY`
   - `GEMINI_API_KEY`
   - `AI_CHUNK_DELAY_MS` (`3000`)
3. Click **Deploy**. Vercel will build the serverless functions via `vercel.json`.

---

## Creator

**Ansh Yadav**
- GitHub: [@Ansh-Yadav-maths-lover](https://github.com/Ansh-Yadav-maths-lover)
- Repository: [Notely](https://github.com/Ansh-Yadav-maths-lover/Notely)

---

## License

MIT © Ansh Yadav
