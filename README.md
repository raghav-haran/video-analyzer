# Video Analyzer

Break any video into scored, content-ready segments. Paste a Google Drive video link, and the app downloads, transcribes, and analyzes it — producing a table of segments with timestamps, summaries, tags, quality scores, and suggested content formats.

## Deploy

### Railway (recommended)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/video-analyzer?referralCode=garyvee)

1. Click the button above or create a new project on [railway.com](https://railway.com)
2. Select **Deploy from GitHub repo** and connect this repo
3. Add environment variables: `ANTHROPIC_API_KEY` and `PPLX_API_KEY`
4. Railway auto-detects the Dockerfile and deploys

### Render

1. Go to [render.com](https://render.com) → New → Web Service
2. Connect this GitHub repo
3. Render auto-detects `render.yaml` and configures everything
4. Add environment variables: `ANTHROPIC_API_KEY` and `PPLX_API_KEY`

### Docker (any server)

```bash
docker build -t video-analyzer .
docker run -p 5000:5000 \
  -e ANTHROPIC_API_KEY=sk-... \
  -e PPLX_API_KEY=pplx-... \
  video-analyzer
```

## How it works

1. **Download** — Fetches the video from Google Drive using `gdown`
2. **Extract audio** — Converts to MP3 with `ffmpeg`
3. **Transcribe** — Generates a word-level timestamped transcript using ElevenLabs Scribe v2
4. **Analyze** — Claude breaks the transcript into 30–90 second segments and scores each one

Each segment includes:
- Start / end timestamps
- Short summary
- Detailed explanation
- Tags
- Clip quality score (1–10)
- Score reason
- Suggested content format (short-form clip, LinkedIn post, Twitter/X post, quote graphic, not useful)

## Stack

- **Frontend:** React + Tailwind CSS + shadcn/ui
- **Backend:** Express + SQLite (Drizzle ORM)
- **Processing:** Python (gdown, ffmpeg, Anthropic SDK, Perplexity SDK)
- **Build:** Vite + esbuild

## Prerequisites

- Node.js 20+
- Python 3.10+
- ffmpeg installed and on PATH
- `gdown` Python package: `pip install gdown`
- `anthropic` Python package: `pip install anthropic`

## Environment variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude analysis |
| `PPLX_API_KEY` | Perplexity API key for ElevenLabs Scribe transcription |

## Local setup

```bash
# Clone the repo
git clone <repo-url>
cd video-analyzer

# Install Node dependencies
npm install

# Install Python dependencies
pip install gdown anthropic

# Set environment variables
export ANTHROPIC_API_KEY=sk-...
export PPLX_API_KEY=pplx-...

# Start the dev server
npm run dev
```

The app runs at `http://localhost:5000`.

## Production build

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

## Project structure

```
video-analyzer/
├── client/
│   └── src/
│       ├── App.tsx            # Router
│       ├── pages/home.tsx     # Main UI (input, results table)
│       └── index.css          # Theme & Tailwind config
├── server/
│   ├── routes.ts              # Express API routes
│   ├── storage.ts             # SQLite CRUD operations
│   ├── db.ts                  # Database setup
│   ├── process_video.py       # Full processing pipeline
│   └── transcribe_audio.py    # Audio transcription helper
├── shared/
│   └── schema.ts              # Zod schemas & DB table definitions
├── Dockerfile                 # Docker config for deployment
├── render.yaml                # Render.com config
├── railway.json               # Railway config
└── package.json
```

## API

### POST /api/analyze

Start a new analysis job.

```json
{
  "driveUrl": "https://drive.google.com/file/d/.../view",
  "useMock": false
}
```

Set `useMock: true` to get sample data for UI testing.

### GET /api/jobs/:id

Poll job status and get results.

```json
{
  "id": 1,
  "status": "complete",
  "segments": [...]
}
```

Status values: `pending`, `downloading`, `extracting_audio`, `transcribing`, `analyzing`, `complete`, `error`

### GET /api/jobs/:id/csv

Download results as CSV.

## UI features

- **Search** — Filter segments by keyword across summaries, explanations, and tags
- **Tag filter** — Dropdown with all unique tags across segments
- **Format filter** — Filter by suggested content format
- **Sort** — By clip quality score (high→low) or timestamp (chronological/reverse)
- **Expand rows** — Click any row to see detailed explanation, score reason, and tags
- **Copy** — Copy all segment data as tab-separated text
- **CSV download** — Export results as a CSV file
- **Sample data** — Click "Load sample data" to preview the UI without processing
