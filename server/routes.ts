import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { spawn, execSync, execFileSync, execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
import path from "path";
import fs from "fs";
import os from "os";
import https from "https";

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
  videoEventDropdown: "e2daf809-477f-4cdd-8cd4-05671201bbda",   // drop_down
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

// Make HTTP requests directly to the agent proxy instead of shelling out to external-tool CLI.
// This reads credentials from process.env (refreshed by the site proxy on each frontend request)
// and avoids the stale /tmp/.tools_service_endpoint file issue.
function getToolsCredentials(): { endpoint: string; key: string; agentId?: string } {
  const endpoint = process.env.ASI_EXTERNAL_TOOLS_ENDPOINT || "";
  const key = process.env.ASI_EXTERNAL_TOOLS_KEY || "";
  const agentId = process.env.ASI_AGENT_ID;
  if (!endpoint || !key) {
    // Fallback: try reading from the file
    try {
      const config = JSON.parse(fs.readFileSync("/tmp/.tools_service_endpoint", "utf-8"));
      return { endpoint: config.endpoint, key: config.key, agentId: config.agent_id };
    } catch {
      throw new Error("No external tools credentials available");
    }
  }
  return { endpoint, key, agentId };
}

async function callExternalToolAsync(sourceId: string, toolName: string, args: Record<string, any>): Promise<any> {
  const { endpoint, key, agentId } = getToolsCredentials();
  const url = `${endpoint}/rest/connector-service/connectors/${sourceId}/tools/${toolName}/execute`;

  const body = JSON.stringify({ parameters: args });
  const headers: Record<string, string> = {
    "x-api-key": key,
    "Content-Type": "application/json",
  };
  if (agentId) headers["X-Agent-ID"] = agentId;

  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST", headers, timeout: 60000 }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          // Mirror the external-tool CLI response handling
          const status = parsed.status;
          if (status === "auth_required") {
            reject(new Error(`auth_required for ${sourceId}`));
            return;
          }
          if (status === "error") {
            const msg = parsed.error_message || parsed.content || "unknown error";
            reject(new Error(`API error: ${typeof msg === 'string' ? msg.slice(0, 300) : JSON.stringify(msg).slice(0, 300)}`));
            return;
          }
          // Extract content (same as CLI)
          let content = parsed.content;
          if (typeof content === "string") {
            try { content = JSON.parse(content); } catch {}
          }
          resolve(content);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    req.write(body);
    req.end();
  });
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
  // Refresh LLM credential files on every request (the proxy refreshes process.env per request)
  app.use((_req, _res, next) => {
    // Update any active LLM cred files so long-running Python processes get fresh keys
    try {
      const homeDir = os.homedir();
      const files = fs.readdirSync(homeDir).filter(f => f.startsWith('llm-creds-'));
      for (const file of files) {
        fs.writeFileSync(path.join(homeDir, file), JSON.stringify({
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
          ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "",
        }));
      }
    } catch {}
    next();
  });

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

  // In-memory store for push jobs (async background processing)
  const pushJobs = new Map<string, {
    status: "running" | "complete" | "error";
    total: number;
    succeeded: number;
    failed: number;
    current: number;
    results: Array<{ segment: string; taskId?: string; error?: string }>;
    error?: string;
    dropdownMatched?: boolean;
    dropdownWarning?: string;
  }>();

  // POST /api/clickup/push — Start pushing segments to ClickUp (async)
  app.post("/api/clickup/push", (req, res) => {
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

    const segmentsToPush = segmentIndices
      ? segmentIndices.map((i: number) => allSegments[i]).filter(Boolean)
      : allSegments;

    if (segmentsToPush.length === 0) {
      return res.status(400).json({ error: "No segments to push" });
    }

    // Create a push job ID and return immediately
    const pushId = `push-${Date.now()}`;
    pushJobs.set(pushId, {
      status: "running",
      total: segmentsToPush.length,
      succeeded: 0,
      failed: 0,
      current: 0,
      results: [],
    });

    // Return immediately — processing happens in background
    res.json({ pushId, total: segmentsToPush.length });

    // Process segments in the background
    (async () => {
      const pushJob = pushJobs.get(pushId)!;

      // Fetch current dropdown options for "Video/Event Name (Dropdown)" field
      let dropdownOptionId: string | null = null;
      if (job.eventName) {
        // Wait a moment for frontend polling to refresh credentials
        await new Promise(r => setTimeout(r, 2000));

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const fieldsResult = await callExternalToolAsync("clickup__pipedream", "clickup-get-custom-fields", {
              workspaceId: "9017366055",
              spaceId: "90173833877",
              listId: CLICKUP_LIST_ID,
            });
            // Parse the response — callExternalToolAsync now returns parsed content directly
            let fields = fieldsResult;
            if (fields?.fields) fields = fields.fields;
            console.log(`[ClickUp] Fields response type: ${typeof fields}, isArray: ${Array.isArray(fields)}, length: ${Array.isArray(fields) ? fields.length : 'n/a'}`);
            if (Array.isArray(fields)) {
              const dropdownField = fields.find((f: any) => f.id === CLICKUP_CUSTOM_FIELDS.videoEventDropdown);
              if (dropdownField?.type_config?.options) {
                const eventNameLower = job.eventName.toLowerCase().trim();
                console.log(`[ClickUp] Looking for "${eventNameLower}" in ${dropdownField.type_config.options.length} options: ${dropdownField.type_config.options.map((o: any) => `"${o.name}"`).join(", ")}`);
                const matchedOption = dropdownField.type_config.options.find(
                  (opt: any) => opt.name.toLowerCase().trim() === eventNameLower
                );
                if (matchedOption) {
                  dropdownOptionId = matchedOption.id;
                  console.log(`[ClickUp] Matched dropdown option: "${matchedOption.name}" (${matchedOption.id})`);
                } else {
                  console.log(`[ClickUp] No dropdown option found for "${job.eventName}".`);
                }
              } else {
                console.log(`[ClickUp] Dropdown field not found or has no options.`);
              }
            } else {
              console.log(`[ClickUp] Unexpected fields format:`, JSON.stringify(fields).slice(0, 300));
            }
            break; // success — exit retry loop
          } catch (err: any) {
            console.error(`[ClickUp] Dropdown fetch attempt ${attempt + 1} failed:`, err.message?.slice(0, 200));
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 3000)); // wait before retry
            }
          }
        }
      }

      // Helper: retry an external tool call up to 3 times with delay
      async function callWithRetry(sourceId: string, toolName: string, args: Record<string, any>, retries = 3): Promise<any> {
        for (let attempt = 0; attempt < retries; attempt++) {
          try {
            return await callExternalToolAsync(sourceId, toolName, args);
          } catch (err: any) {
            const isAuthError = err.message?.includes('expired') || err.message?.includes('auth') || err.message?.includes('401');
            if (isAuthError && attempt < retries - 1) {
              console.log(`[ClickUp] Auth error on ${toolName}, retrying in 3s (attempt ${attempt + 1}/${retries})...`);
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }
            throw err;
          }
        }
      }

      for (let segIdx = 0; segIdx < segmentsToPush.length; segIdx++) {
        const seg = segmentsToPush[segIdx];
        pushJob.current++;

        // Pause every 3 segments to let frontend polling refresh credentials
        if (segIdx > 0 && segIdx % 3 === 0) {
          await new Promise(r => setTimeout(r, 2000));
        }

        try {
          const descTimestamp = `[${seg.start} – ${seg.end}] ${seg.detailedExplanation}`;
          const ratingStr = "\u{1F525}".repeat(Math.min(Math.max(seg.rating || 1, 1), 3));

          // Create the task (with retry)
          const createResult = await callWithRetry("clickup__pipedream", "clickup-create-task", {
            workspaceId: "9017366055",
            spaceId: "90173833877",
            name: seg.shortSummary,
            listId: CLICKUP_LIST_ID,
            status: "to do",
            description: descTimestamp,
          });

          const taskId = createResult?.id;
          if (!taskId) {
            pushJob.failed++;
            pushJob.results.push({ segment: seg.shortSummary, error: "No task ID returned" });
            continue;
          }

          // Set custom fields
          const fieldsToSet: Array<{ fieldId: string; value: any }> = [
            { fieldId: CLICKUP_CUSTOM_FIELDS.videoEventName, value: job.eventName || "" },
            { fieldId: CLICKUP_CUSTOM_FIELDS.descriptionTimestamp, value: descTimestamp },
            { fieldId: CLICKUP_CUSTOM_FIELDS.ratings, value: ratingStr },
            { fieldId: CLICKUP_CUSTOM_FIELDS.fileLocation, value: job.driveUrl || "" },
            { fieldId: CLICKUP_CUSTOM_FIELDS.loggingDate, value: Date.now().toString() },
          ];

          // Set dropdown value if we found a matching option
          if (dropdownOptionId) {
            fieldsToSet.push({ fieldId: CLICKUP_CUSTOM_FIELDS.videoEventDropdown, value: dropdownOptionId });
          }

          if (job.dateFilmed) {
            const dateMs = new Date(job.dateFilmed).getTime();
            if (!isNaN(dateMs)) {
              fieldsToSet.push({ fieldId: CLICKUP_CUSTOM_FIELDS.dateFilmed, value: dateMs.toString() });
            }
          }

          const matchedTagIds = matchTagsToClickUp(seg.tags || "");
          if (matchedTagIds.length > 0) {
            fieldsToSet.push({ fieldId: CLICKUP_CUSTOM_FIELDS.tagsKeywords, value: matchedTagIds });
          }

          for (const field of fieldsToSet) {
            try {
              await callWithRetry("clickup__pipedream", "clickup-update-task-custom-field", {
                workspaceId: "9017366055",
                spaceId: "90173833877",
                listId: CLICKUP_LIST_ID,
                taskId,
                customFieldId: field.fieldId,
                value: field.value,
              });
            } catch (fieldErr: any) {
              console.error(`[ClickUp] Field error on ${taskId}:`, (fieldErr.stderr?.toString?.() || fieldErr.message || "").slice(0, 200));
            }
          }

          pushJob.succeeded++;
          pushJob.results.push({ segment: seg.shortSummary, taskId });
        } catch (segErr: any) {
          pushJob.failed++;
          pushJob.results.push({ segment: seg.shortSummary, error: (segErr.message || "").slice(0, 200) });
        }
      }

      pushJob.status = "complete";
      if (job.eventName && !dropdownOptionId) {
        pushJob.dropdownMatched = false;
        pushJob.dropdownWarning = `Dropdown option "${job.eventName}" not found in ClickUp. Add it manually in ClickUp, then push again to assign it.`;
      } else if (dropdownOptionId) {
        pushJob.dropdownMatched = true;
      }
      // Clean up after 5 minutes
      setTimeout(() => pushJobs.delete(pushId), 5 * 60 * 1000);
    })();
  });

  // GET /api/clickup/push/:pushId — Poll push progress
  app.get("/api/clickup/push/:pushId", (req, res) => {
    const pushJob = pushJobs.get(req.params.pushId);
    if (!pushJob) {
      return res.status(404).json({ error: "Push job not found" });
    }
    res.json(pushJob);
  });

  // GET /api/clickup/dropdown-options — Return available event name dropdown options from ClickUp
  app.get("/api/clickup/dropdown-options", async (_req, res) => {
    try {
      const fieldsResult = await callExternalToolAsync("clickup__pipedream", "clickup-get-custom-fields", {
        workspaceId: "9017366055",
        spaceId: "90173833877",
        listId: CLICKUP_LIST_ID,
      });
      let fields = fieldsResult;
      if (fields?.fields) fields = fields.fields;
      if (Array.isArray(fields)) {
        const dropdownField = fields.find((f: any) => f.id === CLICKUP_CUSTOM_FIELDS.videoEventDropdown);
        if (dropdownField?.type_config?.options) {
          res.json(dropdownField.type_config.options.map((opt: any) => ({
            id: opt.id,
            name: opt.name,
            color: opt.color,
          })));
          return;
        }
      }
      res.json([]);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch dropdown options", details: err.message?.slice(0, 200) });
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

  // Write a credential file the Python script can read right before making API calls.
  // process.env gets stale for long-running child processes, so we write fresh creds
  // to a file and the Python script reads from it at the moment it needs the key.
  const credsPath = path.join(os.homedir(), `llm-creds-${jobId}.json`);
  try {
    fs.writeFileSync(credsPath, JSON.stringify({
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "",
    }));
  } catch (e) {
    console.error(`[Job ${jobId}] Failed to write LLM creds file:`, e);
  }

  const proc = spawn("python3", [scriptPath, driveUrl, outputPath, statusPath, credsPath], {
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
    try { fs.unlinkSync(credsPath); } catch {}
  });

  proc.stderr.on("data", (data) => {
    const chunk = data.toString();
    stderrOutput += chunk;
    console.error(`[Job ${jobId}] stderr: ${chunk.slice(0, 200)}`);
  });
}
