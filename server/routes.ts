import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { spawn, execSync, execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

// ClickUp integration constants
const CLICKUP_LIST_ID = "901712538913";
const CLICKUP_CUSTOM_FIELDS = {
  videoEventName: "04008d34-2218-49d4-93af-5cad22946c0f",       // short_text
  descriptionTimestamp: "05948b16-9312-4fd1-b335-05281443f612",  // short_text
  dateFilmed: "40f56894-f0ac-42e3-a93f-3a1860cd9647",           // date (ms timestamp)
  ratings: "d162e535-bf06-41cc-b40a-b8e9169cc3ff",               // short_text
  fileLocation: "c91c79de-536d-46a7-a092-c3c48c5b71c5",         // short_text
  tagsKeywords: "f5957548-bf3c-4ba7-8775-27ae5db08190",         // labels
  loggingDate: "944000a4-2aba-434d-a4b6-8970dc918b23",          // date (ms timestamp)
};

// Predefined tag labels in ClickUp (id → label)
const CLICKUP_TAG_OPTIONS: Record<string, string> = {
  "3260ebb6-06a4-49db-8951-243b3179a274": "NFTs",
  "52da4065-d027-4cbf-a5b1-fa7a39d9fad7": "Funny",
  "bd8ba411-9635-4ba1-9cf9-bc66cea825c9": "College",
  "79ec32f1-abe6-4003-ab58-40f80d404f4f": "B-Roll 🎥",
  "b4ea6423-294d-4426-ad89-ea8f8787fa20": "Life Advice",
  "4b6e9684-b879-47d3-8a27-229af5af6dac": "Predictions",
  "86654f1f-8883-407c-8102-2e50e3278734": "Quick Quote",
  "66a4c7f6-653e-48a6-9705-4219c140f182": "Motivational",
  "dbd1f6f7-cea1-4a45-9cc7-3b5ac0b965f0": "Business talk",
  "4f6a4aa1-3bbd-4728-a28e-1887aebbd066": "Company culture",
  "a7bd3c06-c01b-4765-9a27-c53098e68bbb": "Random chit chat",
  "51727dfd-42c5-413d-8768-5ae96c17a953": "12-1/2 Ingredients",
  "4aa03932-bb30-4844-812e-ece8a64c8177": "VaynerMedia related",
  "746e0bfe-16a5-48fa-96eb-a797c8a65474": "VeeFriends the brand",
  "2c93eba8-079b-4aca-8e06-5b3fe84c7ec0": "Gary-Isms / Experiences",
  "4eded567-19ed-4d26-9f29-0b7f65a9237b": "Storytime/History Lesson",
};

// Reverse map: label → id for quick lookup
const TAG_LABEL_TO_ID: Record<string, string> = {};
for (const [id, label] of Object.entries(CLICKUP_TAG_OPTIONS)) {
  TAG_LABEL_TO_ID[label.toLowerCase()] = id;
}

function callExternalTool(sourceId: string, toolName: string, args: Record<string, any>): any {
  const params = JSON.stringify({ source_id: sourceId, tool_name: toolName, arguments: args });
  // Use execFileSync to avoid shell escaping issues with quotes/emojis
  const result = execFileSync("external-tool", ["call", params], {
    encoding: "utf-8",
    timeout: 30000,
  });
  const parsed = JSON.parse(result.trim() || '{}');
  if (parsed.error) {
    throw new Error(`ClickUp API error: ${parsed.error}`);
  }
  return parsed;
}

function matchTagsToClickUp(segmentTags: string): string[] {
  // Try to match segment tags to predefined ClickUp label IDs
  const tags = segmentTags.split(",").map(t => t.trim().toLowerCase());
  const matchedIds: string[] = [];
  for (const tag of tags) {
    // Direct match
    if (TAG_LABEL_TO_ID[tag]) {
      matchedIds.push(TAG_LABEL_TO_ID[tag]);
      continue;
    }
    // Fuzzy match: check if any predefined label contains the tag or vice versa
    for (const [label, id] of Object.entries(TAG_LABEL_TO_ID)) {
      if (label.includes(tag) || tag.includes(label)) {
        matchedIds.push(id);
        break;
      }
    }
  }
  return [...new Set(matchedIds)]; // dedupe
}
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

  // POST /api/clickup/push — Push segments to ClickUp as tasks
  app.post("/api/clickup/push", async (req, res) => {
    try {
      const { jobId, segmentIndices } = req.body;

      if (!jobId) {
        return res.status(400).json({ error: "jobId is required" });
      }

      const job = storage.getJob(jobId);
      if (!job || !job.result) {
        return res.status(404).json({ error: "Job not found or no results" });
      }

      const parsed = JSON.parse(job.result);
      const allSegments = Array.isArray(parsed) ? parsed : (parsed.segments || []);

      // If segmentIndices provided, push only those; otherwise push all
      const segmentsToPush = segmentIndices
        ? segmentIndices.map((i: number) => allSegments[i]).filter(Boolean)
        : allSegments;

      if (segmentsToPush.length === 0) {
        return res.status(400).json({ error: "No segments to push" });
      }

      const results: Array<{ segment: string; taskId?: string; error?: string }> = [];

      for (const seg of segmentsToPush) {
        try {
          // Build the description/timestamp field
          const descTimestamp = `[${seg.start} – ${seg.end}] ${seg.detailedExplanation}`;

          // Build rating string
          const ratingStr = "🔥".repeat(Math.min(Math.max(seg.rating || 1, 1), 3));

          // Step 1: Create the task
          const createResult = callExternalTool("clickup__pipedream", "clickup-create-task", {
            workspaceId: "9017366055",
            spaceId: "90173833877",
            name: seg.shortSummary,
            listId: CLICKUP_LIST_ID,
            status: "to do",
            description: descTimestamp,
          });

          const taskId = createResult?.id;
          if (!taskId) {
            results.push({ segment: seg.shortSummary, error: "Failed to create task — no ID returned" });
            continue;
          }

          // Step 2: Set custom fields one by one
          const fieldsToSet: Array<{ fieldId: string; value: any }> = [
            // Video/Event Name
            { fieldId: CLICKUP_CUSTOM_FIELDS.videoEventName, value: job.eventName || "" },
            // Description / Timestamp
            { fieldId: CLICKUP_CUSTOM_FIELDS.descriptionTimestamp, value: descTimestamp },
            // Ratings
            { fieldId: CLICKUP_CUSTOM_FIELDS.ratings, value: ratingStr },
            // File Location (drive URL)
            { fieldId: CLICKUP_CUSTOM_FIELDS.fileLocation, value: job.driveUrl || "" },
            // Logging Date (now, in ms)
            { fieldId: CLICKUP_CUSTOM_FIELDS.loggingDate, value: Date.now().toString() },
          ];

          // Date Filmed (if provided)
          if (job.dateFilmed) {
            const dateMs = new Date(job.dateFilmed).getTime();
            if (!isNaN(dateMs)) {
              fieldsToSet.push({ fieldId: CLICKUP_CUSTOM_FIELDS.dateFilmed, value: dateMs.toString() });
            }
          }

          // Tags / Keywords (match segment tags to ClickUp labels)
          const matchedTagIds = matchTagsToClickUp(seg.tags || "");
          if (matchedTagIds.length > 0) {
            fieldsToSet.push({
              fieldId: CLICKUP_CUSTOM_FIELDS.tagsKeywords,
              value: matchedTagIds,
            });
          }

          // Set each custom field
          for (const field of fieldsToSet) {
            try {
              callExternalTool("clickup__pipedream", "clickup-update-task-custom-field", {
                workspaceId: "9017366055",
                spaceId: "90173833877",
                listId: CLICKUP_LIST_ID,
                taskId,
                customFieldId: field.fieldId,
                value: field.value,
              });
            } catch (fieldErr: any) {
              const errMsg = fieldErr.stderr?.toString?.() || fieldErr.message || 'unknown error';
              console.error(`[ClickUp] Failed to set field ${field.fieldId} on task ${taskId}:`, errMsg.slice(0, 300));
            }
          }

          results.push({ segment: seg.shortSummary, taskId });
        } catch (segErr: any) {
          results.push({ segment: seg.shortSummary, error: segErr.message?.slice(0, 200) });
        }
      }

      const succeeded = results.filter(r => r.taskId).length;
      const failed = results.filter(r => r.error).length;

      res.json({
        message: `Pushed ${succeeded} of ${results.length} segments to ClickUp`,
        succeeded,
        failed,
        results,
      });
    } catch (err: any) {
      console.error("[ClickUp Push] Error:", err.message);
      res.status(500).json({ error: err.message || "Failed to push to ClickUp" });
    }
  });

  // GET /api/clickup/tags — Return available ClickUp tag labels for mapping
  app.get("/api/clickup/tags", (_req, res) => {
    const tags = Object.entries(CLICKUP_TAG_OPTIONS).map(([id, label]) => ({ id, label }));
    res.json(tags);
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
