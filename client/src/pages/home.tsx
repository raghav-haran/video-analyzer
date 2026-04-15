import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Download,
  Copy,
  Loader2,
  ArrowUpDown,
  Film,
  Clock,
  Tag,
  Flame,
  ChevronDown,
  ChevronUp,
  X,
  Quote as QuoteIcon,
  LayoutList,
  Calendar,
  Upload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { Segment, Quote } from "@shared/schema";

const FORMAT_COLORS: Record<string, string> = {
  "short-form clip": "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  "LinkedIn post": "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  "Twitter/X post": "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  "quote graphic": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "not useful": "bg-neutral-100 text-neutral-500 dark:bg-neutral-800/40 dark:text-neutral-400",
};

function RatingFire({ rating }: { rating: number }) {
  const fires = Math.min(Math.max(rating, 1), 3);
  return (
    <span className="text-sm whitespace-nowrap" title={`Rating: ${fires}/3`}>
      {"🔥".repeat(fires)}
    </span>
  );
}

interface JobResponse {
  id: number;
  driveUrl: string;
  eventName?: string;
  dateFilmed?: string;
  status: string;
  statusMessage?: string;
  segments?: Segment[];
  quotes?: Quote[];
}

const STATUS_MESSAGES: Record<string, string> = {
  pending: "Queued for processing...",
  downloading: "Downloading video from Google Drive...",
  transcribing: "Transcribing audio with timestamps...",
  analyzing: "Analyzing transcript and creating segments...",
  complete: "Analysis complete",
  error: "An error occurred",
};

export default function Home() {
  const [driveUrl, setDriveUrl] = useState("");
  const [eventName, setEventName] = useState("");
  const [dateFilmed, setDateFilmed] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"time" | "score">("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<"segments" | "quotes">("segments");
  const [pushResult, setPushResult] = useState<{ succeeded: number; failed: number; total: number } | null>(null);
  const { toast } = useToast();

  // Poll for job status
  const {
    data: job,
    isLoading: jobLoading,
  } = useQuery<JobResponse>({
    queryKey: ["/api/jobs", jobId],
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const data = query.state.data as JobResponse | undefined;
      if (!data) return 2000;
      if (data.status === "complete" || data.status === "error") return false;
      return 2000;
    },
  });

  // Submit analysis
  const analyzeMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/analyze", { driveUrl: url, eventName: eventName || undefined, dateFilmed: dateFilmed || undefined });
      return res.json();
    },
    onSuccess: (data: { jobId: number }) => {
      setJobId(data.jobId);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", data.jobId] });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to start analysis",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Load mock data
  const mockMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/analyze", {
        driveUrl: "https://drive.google.com/file/d/MOCK_TEST_ID/view",
        eventName: eventName || undefined,
        dateFilmed: dateFilmed || undefined,
        useMock: true,
      });
      return res.json();
    },
    onSuccess: (data: { jobId: number }) => {
      setJobId(data.jobId);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", data.jobId] });
    },
  });

  // Push to ClickUp mutation
  const clickupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/clickup/push", { jobId });
      return res.json();
    },
    onSuccess: (data: { succeeded: number; failed: number; results: any[] }) => {
      setPushResult({ succeeded: data.succeeded, failed: data.failed, total: data.results.length });
      toast({
        title: data.failed === 0
          ? `Pushed ${data.succeeded} moments to ClickUp`
          : `Pushed ${data.succeeded} of ${data.results.length} (${data.failed} failed)`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to push to ClickUp",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const segments = job?.segments || [];
  const quotes = job?.quotes || [];
  const isProcessing =
    job && !["complete", "error"].includes(job.status) && jobId !== null;

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    segments.forEach((seg) => {
      seg.tags.split(",").forEach((t) => {
        const tag = t.trim();
        if (tag) tagSet.add(tag);
      });
    });
    return Array.from(tagSet).sort();
  }, [segments]);

  // Filter and sort
  const filteredSegments = useMemo(() => {
    let result = [...segments];

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (seg) =>
          seg.shortSummary.toLowerCase().includes(q) ||
          seg.detailedExplanation.toLowerCase().includes(q) ||
          seg.tags.toLowerCase().includes(q) ||
          seg.scoreReason.toLowerCase().includes(q),
      );
    }

    // Tag filter
    if (tagFilter !== "all") {
      result = result.filter((seg) =>
        seg.tags
          .split(",")
          .map((t) => t.trim())
          .includes(tagFilter),
      );
    }

    // Format filter
    if (formatFilter !== "all") {
      result = result.filter((seg) => seg.suggestedFormat === formatFilter);
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === "score") {
        return sortDir === "desc"
          ? b.rating - a.rating
          : a.rating - b.rating;
      }
      // time sort
      const aTime = a.start.split(":").reduce((acc, v) => acc * 60 + parseInt(v), 0);
      const bTime = b.start.split(":").reduce((acc, v) => acc * 60 + parseInt(v), 0);
      return sortDir === "desc" ? bTime - aTime : aTime - bTime;
    });

    return result;
  }, [segments, searchQuery, tagFilter, formatFilter, sortBy, sortDir]);

  const toggleRow = useCallback((idx: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleCopyResults = useCallback(() => {
    if (activeTab === "quotes") {
      const text = quotes
        .map((q) => `[${q.timestamp}] "${q.quote}"`)
        .join("\n");
      navigator.clipboard.writeText(text);
      toast({ title: `Copied ${quotes.length} quotes to clipboard` });
    } else {
      const text = filteredSegments
        .map(
          (seg) =>
            `[${seg.start}–${seg.end}] ${seg.shortSummary}\nRating: ${"🔥".repeat(seg.rating)} | Format: ${seg.suggestedFormat}\n${seg.detailedExplanation}\nTags: ${seg.tags}\n`,
        )
        .join("\n");
      navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    }
  }, [activeTab, filteredSegments, quotes, toast]);

  const handleDownloadCsv = useCallback(() => {
    if (!jobId) return;
    window.open(`/api/jobs/${jobId}/csv`, "_blank");
  }, [jobId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!driveUrl.trim()) return;
    analyzeMutation.mutate(driveUrl.trim());
  };

  const handleReset = () => {
    setJobId(null);
    setDriveUrl("");
    setEventName("");
    setDateFilmed("");
    setSearchQuery("");
    setTagFilter("all");
    setFormatFilter("all");
    setSortBy("time");
    setSortDir("desc");
    setExpandedRows(new Set());
    setActiveTab("segments");
    setPushResult(null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center">
              <Film className="w-4 h-4 text-background" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">Video Analyzer</h1>
              <p className="text-xs text-muted-foreground">
                Break any video into content-ready segments
              </p>
            </div>
          </div>
          {job?.status === "complete" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              data-testid="button-reset"
            >
              Analyze another
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Input Section */}
        {(!job || job.status === "error") && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-xl font-semibold mb-2">
                Analyze a video
              </h2>
              <p className="text-sm text-muted-foreground">
                Paste a Google Drive video link to break it into scored,
                content-ready segments.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="https://drive.google.com/file/d/..."
                  value={driveUrl}
                  onChange={(e) => setDriveUrl(e.target.value)}
                  className="flex-1"
                  data-testid="input-drive-url"
                />
                <Button
                  type="submit"
                  disabled={!driveUrl.trim() || analyzeMutation.isPending}
                  data-testid="button-analyze"
                >
                  {analyzeMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  Analyze
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <Film className="w-4 h-4 text-muted-foreground shrink-0" />
                  <Input
                    type="text"
                    placeholder="Event name (e.g. Vibe Family Q&A)"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    data-testid="input-event-name"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                  <Input
                    type="date"
                    value={dateFilmed}
                    onChange={(e) => setDateFilmed(e.target.value)}
                    className="w-[180px]"
                    data-testid="input-date-filmed"
                  />
                </div>
              </div>

              {job?.status === "error" && (
                <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
                  {job.statusMessage || "An unknown error occurred"}
                </div>
              )}
            </form>

            <div className="mt-4 text-center">
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                onClick={() => mockMutation.mutate()}
                disabled={mockMutation.isPending}
                data-testid="button-load-mock"
              >
                Load sample data to preview the UI
              </button>
            </div>
          </div>
        )}

        {/* Processing State */}
        {isProcessing && (
          <div className="max-w-md mx-auto text-center py-16">
            <div className="relative w-16 h-16 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-2 border-muted" />
              <div className="absolute inset-0 rounded-full border-2 border-foreground border-t-transparent animate-spin" />
              <Film className="absolute inset-0 m-auto w-6 h-6 text-muted-foreground" />
            </div>
            <p className="font-medium mb-1">
              {STATUS_MESSAGES[job!.status] || job!.status}
            </p>
            <p className="text-sm text-muted-foreground">
              {job!.statusMessage || "This may take a few minutes for longer videos"}
            </p>

            <div className="mt-6 flex justify-center gap-2">
              {["downloading", "transcribing", "analyzing"].map((step, i) => {
                const currentIdx = ["downloading", "transcribing", "analyzing"].indexOf(job!.status);
                const isActive = i === currentIdx;
                const isDone = i < currentIdx;
                return (
                  <div
                    key={step}
                    className={`h-1 w-16 rounded-full transition-colors ${
                      isDone
                        ? "bg-foreground"
                        : isActive
                          ? "bg-foreground/60"
                          : "bg-muted"
                    }`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Results */}
        {job?.status === "complete" && segments.length > 0 && (
          <div className="space-y-4">
            {/* Stats bar + Tab toggle */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {segments.length} segments
                </span>
                <span>·</span>
                <span>
                  {segments.filter((s) => s.rating === 3).length} 🔥🔥🔥
                </span>
                <span>·</span>
                <span>
                  {segments.filter((s) => s.rating === 2).length} 🔥🔥
                </span>
                <span>·</span>
                <span>
                  {quotes.length} quotes
                </span>
              </div>

              <div className="flex items-center bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setActiveTab("segments")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === "segments"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid="tab-segments"
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  Segments
                </button>
                <button
                  onClick={() => setActiveTab("quotes")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === "quotes"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid="tab-quotes"
                >
                  <QuoteIcon className="w-3.5 h-3.5" />
                  Quotes ({quotes.length})
                </button>
              </div>
            </div>

            {/* Controls — only show for segments tab */}
            {activeTab === "segments" && (
            <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search segments..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>

              <Select value={tagFilter} onValueChange={setTagFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-tag-filter">
                  <Tag className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="All tags" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tags</SelectItem>
                  {allTags.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={formatFilter} onValueChange={setFormatFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-format-filter">
                  <SelectValue placeholder="All formats" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All formats</SelectItem>
                  <SelectItem value="short-form clip">Short-form clip</SelectItem>
                  <SelectItem value="LinkedIn post">LinkedIn post</SelectItem>
                  <SelectItem value="Twitter/X post">Twitter/X post</SelectItem>
                  <SelectItem value="quote graphic">Quote graphic</SelectItem>
                  <SelectItem value="not useful">Not useful</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (sortBy === "score") {
                    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                  } else {
                    setSortBy("score");
                    setSortDir("desc");
                  }
                }}
                className={sortBy === "score" ? "border-foreground/30" : ""}
                data-testid="button-sort-score"
              >
                <Flame className="w-3.5 h-3.5 mr-1.5" />
                Rating
                {sortBy === "score" &&
                  (sortDir === "desc" ? (
                    <ChevronDown className="w-3.5 h-3.5 ml-1" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5 ml-1" />
                  ))}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (sortBy === "time") {
                    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                  } else {
                    setSortBy("time");
                    setSortDir("asc");
                  }
                }}
                className={sortBy === "time" ? "border-foreground/30" : ""}
                data-testid="button-sort-time"
              >
                <Clock className="w-3.5 h-3.5 mr-1.5" />
                Time
                {sortBy === "time" &&
                  (sortDir === "asc" ? (
                    <ChevronUp className="w-3.5 h-3.5 ml-1" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 ml-1" />
                  ))}
              </Button>

              <div className="ml-auto flex items-center gap-2">
                {pushResult && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {pushResult.failed === 0 ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                    )}
                    {pushResult.succeeded}/{pushResult.total} pushed
                  </span>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={pushResult ? "outline" : "default"}
                      size="sm"
                      onClick={() => clickupMutation.mutate()}
                      disabled={clickupMutation.isPending}
                      data-testid="button-push-clickup"
                    >
                      {clickupMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      {clickupMutation.isPending ? "Pushing..." : "Push to ClickUp"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Create tasks in ClickUp for all segments</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyResults}
                      data-testid="button-copy"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy results</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadCsv}
                      data-testid="button-csv"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Download CSV</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Active filters */}
            {(tagFilter !== "all" || formatFilter !== "all" || searchQuery) && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  Showing {filteredSegments.length} of {segments.length}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    setSearchQuery("");
                    setTagFilter("all");
                    setFormatFilter("all");
                  }}
                  data-testid="button-clear-filters"
                >
                  <X className="w-3 h-3 mr-1" />
                  Clear filters
                </Button>
              </div>
            )}

            {/* Results table */}
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left py-2.5 px-3 font-medium text-muted-foreground w-[100px]">
                        Time
                      </th>
                      <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">
                        Summary
                      </th>
                      <th className="text-left py-2.5 px-3 font-medium text-muted-foreground w-[80px]">
                        Rating
                      </th>
                      <th className="text-left py-2.5 px-3 font-medium text-muted-foreground w-[140px]">
                        Format
                      </th>
                      <th className="w-[40px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSegments.map((seg, idx) => {
                      const isExpanded = expandedRows.has(idx);
                      return (
                        <tr
                          key={`${seg.start}-${seg.end}`}
                          className="border-t border-border hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => toggleRow(idx)}
                          data-testid={`row-segment-${idx}`}
                        >
                          <td className="py-2.5 px-3 align-top">
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {seg.start}–{seg.end}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 align-top">
                            <div className="font-medium mb-1 leading-snug">
                              {seg.shortSummary}
                            </div>
                            {isExpanded && (
                              <div className="space-y-2 mt-2 pb-1">
                                <p className="text-muted-foreground leading-relaxed">
                                  {seg.detailedExplanation}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  <span className="font-medium text-foreground/70">
                                    Rating reason:
                                  </span>{" "}
                                  {seg.ratingReason}
                                </p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {seg.tags.split(",").map((t) => {
                                    const tag = t.trim();
                                    return tag ? (
                                      <Badge
                                        key={tag}
                                        variant="secondary"
                                        className="text-[10px] h-5 px-1.5 cursor-pointer"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setTagFilter(tag);
                                        }}
                                      >
                                        {tag}
                                      </Badge>
                                    ) : null;
                                  })}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 align-top">
                            <RatingFire rating={seg.rating} />
                          </td>
                          <td className="py-2.5 px-3 align-top">
                            <span
                              className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${FORMAT_COLORS[seg.suggestedFormat] || ""}`}
                            >
                              {seg.suggestedFormat}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 align-top">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredSegments.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  No segments match your filters
                </div>
              )}
            </div>
            </>
            )}

            {/* Quotes tab */}
            {activeTab === "quotes" && (
              <>
                <div className="flex items-center justify-end gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyResults}
                        data-testid="button-copy-quotes"
                      >
                        <Copy className="w-3.5 h-3.5 mr-1.5" />
                        Copy all
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy all quotes</TooltipContent>
                  </Tooltip>
                </div>

                {quotes.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    No quotes extracted from this video
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {quotes.map((q, idx) => (
                      <div
                        key={idx}
                        className="border border-border rounded-lg p-4 hover:bg-muted/30 transition-colors group"
                        data-testid={`quote-${idx}`}
                      >
                        <div className="flex items-start gap-3">
                          <QuoteIcon className="w-4 h-4 text-muted-foreground/50 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-relaxed">
                              “{q.quote}”
                            </p>
                            <span className="inline-block mt-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                              {q.timestamp}
                            </span>
                          </div>
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            onClick={() => {
                              navigator.clipboard.writeText(q.quote);
                              toast({ title: "Quote copied" });
                            }}
                            data-testid={`copy-quote-${idx}`}
                          >
                            <Copy className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
