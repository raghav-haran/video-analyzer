import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
// Use process.cwd() for resolving paths — works in both dev (ESM) and prod (CJS bundle)

// Sample mock data for testing UI without processing
const MOCK_SEGMENTS = [
  {
    start: "00:00",
    end: "00:54",
    shortSummary: "Internal team discussion before Q&A",
    detailedExplanation: "Gary speaks with a team member about turnaround time for getting great content in front of him for Instagram. He emphasizes that if something is outstanding, it needs to reach him within 24 hours.",
    tags: "internal, content workflow, Instagram, turnaround time",
    rating: 1,
    ratingReason: "Internal conversation not meant for public. Low engagement value for external audiences.",
    suggestedFormat: "not useful" as const,
  },
  {
    start: "02:04",
    end: "05:37",
    shortSummary: "Gary on why sustainability shouldn't be your only selling point",
    detailedExplanation: "Gary explains the market didn't shift away from sustainability — consumers caught on to inauthentic brands using it as a marketing tactic. His key advice: treat social impact as a 'plus-up,' not the sole reason someone buys. Run your business as if the cause doesn't exist.",
    tags: "sustainability, social impact, authenticity, branding, marketing",
    rating: 3,
    ratingReason: "Extremely high-value advice. The umbrella brand anecdote is memorable. The 'run it as if the cause doesn't exist' framework is quotable.",
    suggestedFormat: "short-form clip" as const,
  },
  {
    start: "06:26",
    end: "09:25",
    shortSummary: "Gary on overcoming donor fatigue through storytelling",
    detailedExplanation: "Gary delivers powerful advice on donor fatigue. Don't have the audacity to assume what you care about is what everyone should care about. Donor fatigue is insular to past donors — millions haven't heard your story yet. One post can change the narrative.",
    tags: "donor fatigue, storytelling, nonprofit, empathy, content creation",
    rating: 3,
    ratingReason: "Incredibly powerful and quotable. The 'don't have the audacity' framework is pure Gary. Multiple clip-worthy moments.",
    suggestedFormat: "short-form clip" as const,
  },
  {
    start: "11:01",
    end: "13:07",
    shortSummary: "AI tools as appetizers and desserts for the core business",
    detailedExplanation: "Gary uses a restaurant metaphor — build low-cost AI SaaS tools as 'amuse-bouche/appetizer' (gateway drug) or 'dessert' (upsell). Warns about expanding to bigger waters: 'You're gonna find very different sharks' like OpenAI and Google.",
    tags: "AI tools, SaaS, business model, restaurant metaphor, niche strategy",
    rating: 2,
    ratingReason: "Brilliant restaurant metaphor. The 'different sharks' warning is quotable. Highly applicable to any business thinking about AI expansion.",
    suggestedFormat: "short-form clip" as const,
  },
  {
    start: "15:20",
    end: "18:50",
    shortSummary: "You don't NEED a personal brand — many other levers in business",
    detailedExplanation: "Counter-narrative from the king of personal branding: 'It is not required to build a personal brand to build a business.' Lists alternative levers: sales, content without you in it, being a great boss, being an innovator. 'The words required or I have to are inappropriate words in business.'",
    tags: "personal brand, business levers, courage, authenticity, self-awareness",
    rating: 3,
    ratingReason: "THE clip. Counter-narrative from the king of personal branding. Swimming/sister story is hilarious. The list of alternative levers is gold. Will resonate with millions of founders.",
    suggestedFormat: "short-form clip" as const,
  },
  {
    start: "19:55",
    end: "24:30",
    shortSummary: "Live Instagram audit of Amsterdam tour account",
    detailedExplanation: "Gary looks up the Instagram account live and discovers a massive gap — last post before the call was September 30th. She clearly scrambled before the meeting. Despite inconsistency, he praises content quality and gives tactical advice: Reels over Stories, cross-platform posting.",
    tags: "content strategy, Instagram audit, consistency, Reels, TikTok, live audit",
    rating: 3,
    ratingReason: "The live audit posting gap discovery is hilarious and relatable. Specific tactical advice is actionable. Masterclass for service businesses.",
    suggestedFormat: "short-form clip" as const,
  },
  {
    start: "24:30",
    end: "27:30",
    shortSummary: "Content compounding and organic growth for direct bookings",
    detailedExplanation: "Gary continues advising on moving away from platform dependency through organic content. One viral TikTok showing a magical tour moment could generate massive awareness. Consistency will naturally drive direct bookings as the brand becomes recognizable.",
    tags: "direct bookings, organic content, viral moments, content compounding, tours",
    rating: 2,
    ratingReason: "Strong continuation with actionable tactics. Advice about capturing authentic moments vs. polished content is valuable for experience-based businesses.",
    suggestedFormat: "LinkedIn post" as const,
  },
  {
    start: "35:30",
    end: "40:05",
    shortSummary: "Phone-free experiences: brilliant business model and 'too polished' content critique",
    detailedExplanation: "Gary endorses the phone-free experience concept: 'Many people making 150-350k a year should build this exact business.' Dismisses phone-free/content paradox. Critiques current content as 'too polished' for an authentic brand. Every event is a 'production day' with interns filming.",
    tags: "phone-free, community building, offline experiences, AI content, production day",
    rating: 3,
    ratingReason: "Multiple powerhouse moments. The '$150-350k business model' endorsement is a headline. 'Too polished' feedback is actionable. Vision of community-building is inspiring.",
    suggestedFormat: "short-form clip" as const,
  },
  {
    start: "41:14",
    end: "43:48",
    shortSummary: "You're bringing $100M brand strategy with zero revenue",
    detailedExplanation: "Gary delivers a reality check on sporting event activations: 'You're bringing a $100 million brand marketing strategy with zero revenue.' One TikTok with 40k views > every sporting event in the country. Sampling is good ONLY if you're filming it for content.",
    tags: "startup strategy, activations, TikTok, content first, sampling, reality check",
    rating: 3,
    ratingReason: "Devastating and brilliant. '$100M strategy with zero revenue' is instantly quotable. The flip to 'one TikTok > every sporting event' is perfect. Multiple clip and quote opportunities.",
    suggestedFormat: "short-form clip" as const,
  },
];

const MOCK_QUOTES = [
  { timestamp: "02:45", quote: "Run your business as if the cause doesn't exist. If it can stand on its own, then the social impact becomes a plus-up, not a crutch." },
  { timestamp: "06:52", quote: "Don't have the audacity to assume what you care about is what everyone should care about." },
  { timestamp: "07:30", quote: "Donor fatigue is insular to your past donors. Millions of people haven't heard your story yet." },
  { timestamp: "11:45", quote: "Build low-cost AI tools as appetizers — a gateway drug to your core business." },
  { timestamp: "12:20", quote: "When you expand to bigger waters, you're gonna find very different sharks." },
  { timestamp: "15:48", quote: "It is not required to build a personal brand to build a business." },
  { timestamp: "16:30", quote: "The words 'required' or 'I have to' are inappropriate words in business." },
  { timestamp: "17:15", quote: "You can be an incredible boss. You can be an innovator. You can be a great salesperson. Personal brand is one of many levers." },
  { timestamp: "35:55", quote: "Many people making 150 to 350K a year should build this exact business." },
  { timestamp: "41:30", quote: "You're bringing a $100 million brand marketing strategy with zero revenue." },
  { timestamp: "42:10", quote: "One TikTok with 40,000 views is greater than every sporting event in the country." },
  { timestamp: "42:45", quote: "Sampling is good only if you're filming it for content." },
];

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // POST /api/analyze — Start a new analysis job
  app.post("/api/analyze", (req, res) => {
    const { driveUrl, eventName, dateFilmed, useMock } = req.body;

    if (!driveUrl) {
      return res.status(400).json({ error: "driveUrl is required" });
    }

    // Validate it looks like a Google Drive URL or file ID
    const drivePattern = /drive\.google\.com|^[a-zA-Z0-9_-]{20,}$/;
    if (!drivePattern.test(driveUrl)) {
      return res.status(400).json({ error: "Invalid Google Drive URL" });
    }

    const job = storage.createJob(driveUrl, eventName, dateFilmed);

    if (useMock) {
      // For testing: immediately return mock data
      storage.updateJobResult(job.id, JSON.stringify({ segments: MOCK_SEGMENTS, quotes: MOCK_QUOTES }));
      return res.json({ jobId: job.id, status: "complete" });
    }

    // Start async processing
    processVideo(job.id, driveUrl);

    res.json({ jobId: job.id, status: "pending" });
  });

  // GET /api/jobs/:id — Get job status and results
  app.get("/api/jobs/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const job = storage.getJob(id);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const response: any = {
      id: job.id,
      driveUrl: job.driveUrl,
      eventName: job.eventName,
      dateFilmed: job.dateFilmed,
      status: job.status,
      statusMessage: job.statusMessage,
      createdAt: job.createdAt,
    };

    if (job.result) {
      try {
        const parsed = JSON.parse(job.result);
        // Support both old format (array of segments) and new format ({ segments, quotes })
        if (Array.isArray(parsed)) {
          response.segments = parsed;
          response.quotes = [];
        } else {
          response.segments = parsed.segments || [];
          response.quotes = parsed.quotes || [];
        }
      } catch {
        response.segments = [];
        response.quotes = [];
      }
    }

    res.json(response);
  });

  // GET /api/jobs/:id/csv — Download results as CSV
  app.get("/api/jobs/:id/csv", (req, res) => {
    const id = parseInt(req.params.id);
    const job = storage.getJob(id);

    if (!job || !job.result) {
      return res.status(404).json({ error: "No results available" });
    }

    const parsed = JSON.parse(job.result);
    const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
    const headers = [
      "Start",
      "End",
      "Short Summary",
      "Detailed Explanation",
      "Tags",
      "Rating",
      "Rating Reason",
      "Suggested Format",
    ];

    const csvRows = [headers.join(",")];
    for (const seg of segments) {
      csvRows.push(
        [
          seg.start,
          seg.end,
          `"${(seg.shortSummary || "").replace(/"/g, '""')}"`,
          `"${(seg.detailedExplanation || "").replace(/"/g, '""')}"`,
          `"${(seg.tags || "").replace(/"/g, '""')}"`,
          seg.rating,
          `"${(seg.ratingReason || "").replace(/"/g, '""')}"`,
          `"${(seg.suggestedFormat || "").replace(/"/g, '""')}"`,
        ].join(","),
      );
    }

    const csv = csvRows.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="video-analysis-${id}.csv"`,
    );
    res.send(csv);
  });

  return httpServer;
}

function processVideo(jobId: number, driveUrl: string) {
  // Use home dir for temp files — os.tmpdir() returns /tmp which is a 4GB tmpfs
  const tmpDir = os.homedir();
  const outputPath = path.join(tmpDir, `result-${jobId}.json`);
  const statusPath = path.join(tmpDir, `status-${jobId}.json`);

  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, "server", "process_video.py");

  const proc = spawn("python3", [scriptPath, driveUrl, outputPath, statusPath], {
    env: { ...process.env },
    cwd: path.join(projectRoot, "server"),
  });

  // Collect stderr for better error messages
  let stderrOutput = "";

  // Poll status file
  const pollInterval = setInterval(() => {
    try {
      if (fs.existsSync(statusPath)) {
        const statusData = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
        storage.updateJobStatus(jobId, statusData.status, statusData.message);
      }
    } catch {}
  }, 2000);

  proc.on("close", (code) => {
    clearInterval(pollInterval);

    if (code === 0 && fs.existsSync(outputPath)) {
      try {
        const result = fs.readFileSync(outputPath, "utf-8");
        JSON.parse(result); // validate
        storage.updateJobResult(jobId, result);
      } catch (e: any) {
        storage.updateJobStatus(jobId, "error", `Failed to read results: ${e.message}`);
      }
    } else {
      // Read final status file first
      try {
        if (fs.existsSync(statusPath)) {
          const statusData = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
          if (statusData.status === "error") {
            storage.updateJobStatus(jobId, "error", statusData.message);
            return;
          }
        }
      } catch {}
      // Fallback: use stderr for a more helpful error message
      const errMsg = stderrOutput.trim().split("\n").pop() || `exit code ${code}`;
      storage.updateJobStatus(jobId, "error", `Processing failed: ${errMsg.slice(0, 300)}`);
    }

    // Cleanup temp files
    try { fs.unlinkSync(outputPath); } catch {}
    try { fs.unlinkSync(statusPath); } catch {}
  });

  proc.stderr.on("data", (data) => {
    const chunk = data.toString();
    stderrOutput += chunk;
    console.error(`[Job ${jobId}] stderr: ${chunk.slice(0, 200)}`);
  });
}
