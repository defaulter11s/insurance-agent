# Insurance Sales Agent — Maya

A voice-first AI insurance sales agent grounded in any uploaded policy document. Maya pitches the product, answers questions, surfaces exclusions, refuses to invent quotes, and includes the IRDAI "subject matter of solicitation" disclosure on call end. Built with Next.js + Gemini + Vercel Blob, deploys to Vercel for free.

## What it does

- **Voice in, voice out** — uses your browser's Web Speech API for STT and TTS (free, no API keys)
- **Policy upload** — drop a PDF, TXT, or Markdown of any insurance policy at runtime; Maya re-grounds on it
- **Bundled demo policy** — Aegis Term Shield Plan loads by default, so you can test instantly
- **Strict grounding** — Maya answers only from the loaded policy, with built-in compliance guardrails (no fabricated quotes, mandatory exclusion disclosure, no invented helplines)
- **Voice-aware system prompt** — responses are formatted for speech: no markdown, no bullets, spelled-out numbers ("eight thousand four hundred" not "8,400")

## Architecture

```
┌──────────────────────────┐
│  Browser (Next.js page)  │
│  - Web Speech API STT    │  ← microphone input
│  - Web Speech API TTS    │  ← Maya's voice
│  - Policy upload         │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  Vercel serverless       │
│  /api/upload-token       │  → Direct-to-Blob signed URLs
│  /api/upload             │  → Fetch Blob, extract text via pdfjs
│  /api/chat               │  → System prompt + policy + history
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  Google Gemini 2.5 Flash │  ← free tier, 1M token context
└──────────────────────────┘
```

## Deployment — quick version

If you've already deployed the bike-troubleshooter project, **the steps are identical**. Three differences only:

1. New GitHub repo (call it `insurance-agent`)
2. New Vercel project — same env var, same Blob store provisioning
3. The bundled Aegis Term Shield demo lets you skip the upload step on first test

### Step 1 — Get a Gemini API key (skip if you already have one)

Use the same key from the bike app, or create a new one at <https://aistudio.google.com/app/apikey>.

### Step 2 — GitHub

1. Unzip the project on your computer
2. Make hidden files visible (Windows: View tab → Hidden items / Mac: `Cmd + Shift + .`)
3. Create a new repo at <https://github.com/new> named `insurance-agent`, leave init checkboxes unchecked
4. On the empty repo page, click "uploading an existing file"
5. Select all 11 items inside the unzipped folder (NOT the wrapper folder), drag in
6. Verify `.env.example`, `.gitignore`, `app/`, `lib/` are all present
7. Commit message: `Initial commit` → Commit changes

### Step 3 — Vercel

1. <https://vercel.com/new> → Import the `insurance-agent` repo
2. Before clicking Deploy, expand **Environment Variables** and add:
   - Name: `GEMINI_API_KEY`
   - Value: your key
3. Click **Deploy** — wait ~90 seconds

### Step 4 — Provision a Blob store (for policy uploads)

If you only want to use the bundled demo policy and never upload, you can skip this. But upload-at-runtime requires Blob.

1. Vercel project → **Storage** tab → **Create Database** → **Blob**
2. Name it `policies`, pick a nearby region, click **Create**
3. Connect it to the `insurance-agent` project when prompted
4. Vercel auto-injects `BLOB_READ_WRITE_TOKEN`
5. Trigger a redeploy: **Deployments** → click `⋯` on latest → **Redeploy**

### Step 5 — Test

Open your live URL.

**Test the demo:**
1. Click "Start the conversation" — Maya greets you in voice
2. Click the gold mic button → say "What's the premium for someone aged 30?"
3. Maya should answer with the figure from the illustration table
4. Try off-policy: "Do you have car insurance?" — should refuse and offer to confirm with underwriting
5. Try a hard test: "I want a quote for a 27-year-old smoker with a 2 crore sum assured" — should NOT invent a quote (27 isn't in the table); should ask for date of birth and run a precise quote

**Test upload:**
1. Click the file icon (top right) → upload a PDF policy
2. Maya re-grounds on the new document
3. Start the conversation again — opener now references the uploaded policy

## File structure

```
insurance-agent/
├── app/
│   ├── api/
│   │   ├── chat/route.ts           Chat endpoint
│   │   ├── upload/route.ts         Fetch Blob, extract text
│   │   └── upload-token/route.ts   Sign Blob upload URLs
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                    Voice-first chat UI
├── lib/
│   ├── default-policy.ts           Bundled Aegis Term Shield
│   ├── llm.ts                      Gemini wrapper
│   └── prompt.ts                   System prompt - the compliance logic
├── .env.example
├── .gitignore
├── next.config.js
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

## How the compliance guardrails work

The system prompt in `lib/prompt.ts` enforces several insurance-specific rules:

- **No invented quotes** — Maya can only quote ages/sums explicitly in the illustration table. For anything else, she asks for date of birth and offers to "run a precise quote with underwriting"
- **Mandatory exclusion disclosure** — when the conversation touches coverage scenarios, Maya proactively surfaces relevant exclusions (suicide clauses, hazardous activities, war exclusions)
- **No fabricated helplines or branch addresses** — Maya offers to follow up via WhatsApp/email rather than inventing contact details
- **IRDAI disclosure on call end** — "Insurance is the subject matter of solicitation. For complete details on risk factors, terms and conditions, please read the policy brochure carefully before concluding the sale."
- **Voice-friendly format** — no markdown, no bullets, spelled-out numbers
- **Prompt injection resistance** — attempts to override the rules trigger a polite redirect

This is the same pattern Skit.ai uses for US debt collections deployments — wrap the LLM in deterministic guardrails because the cost of hallucinated promises is regulatory exposure.

## Voice quality caveat

The Web Speech API uses your browser's built-in voices, which vary wildly:

- **Chrome on Mac/Windows**: decent quality, multiple voices, en-IN options available
- **Safari on Mac/iPhone**: pretty good, the "Samantha" voice is the default
- **Firefox**: STT is unreliable — text mode works fine
- **Mobile Chrome**: works but voice quality is OS-dependent

For production-grade voice (especially Indian accents), swap to:

- **Sarvam AI** (Saaras for STT, Bulbul for TTS) — best for Indic languages and Indian English
- **ElevenLabs** for TTS — better naturalness but paid
- **Deepgram** for STT — better accuracy, paid

The architecture supports a swap: replace the `recognitionRef` setup and `speak()` function in `app/page.tsx`, add server-side proxy routes for the new APIs, and wire up the env vars.

## Common problems

**"Voice input not supported"**
Use Chrome or Edge. Firefox doesn't expose the Web Speech API for STT. Safari is hit-or-miss.

**Voice sounds robotic**
That's the browser's built-in TTS. See the swap suggestions above for production-grade voice.

**Maya keeps using "rupees" but pronounces it weirdly**
The TTS engine doesn't always handle Indic terms well. You can edit the system prompt in `lib/prompt.ts` to request specific phrasings (e.g., "say lakh as one word, lakh, not l-a-k-h").

**PDF upload says "Could not extract readable text"**
The PDF is image-based/scanned. OCR it first using https://www.onlineocr.net and upload the .txt.

**"BLOB_READ_WRITE_TOKEN environment variable is not set"**
You skipped Step 4. Provision the Blob store and redeploy.

**Build fails with type errors mentioning SpeechRecognition**
Pull the latest code — there was a one-time fix for this. The current `app/page.tsx` has it correct.

## Free tier costs

- **Gemini 2.5 Flash**: free, ~10 RPM, ~250 RPD
- **Vercel Hobby**: free, 100GB bandwidth/month
- **Vercel Blob**: free up to 1GB storage. Since we delete each upload immediately after extraction, you'll never get close to the limit
- **Web Speech API**: free, runs entirely in the browser

For demo and learning use, this is genuinely free. Production traffic would push you to paid Gemini at ~$0.15 per million input tokens, which is still very cheap.

## License

MIT — use it however you want.
