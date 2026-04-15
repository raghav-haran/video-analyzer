import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Schema for analysis jobs
export const analysisJobs = sqliteTable("analysis_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  driveUrl: text("drive_url").notNull(),
  eventName: text("event_name"), // name of the video event
  dateFilmed: text("date_filmed"), // date the video was filmed
  status: text("status").notNull().default("pending"), // pending, downloading, transcribing, analyzing, complete, error
  statusMessage: text("status_message"),
  result: text("result"), // JSON string of AnalysisResult
  createdAt: text("created_at").notNull(),
});

export const insertJobSchema = createInsertSchema(analysisJobs).pick({
  driveUrl: true,
  eventName: true,
  dateFilmed: true,
});

export type InsertJob = z.infer<typeof insertJobSchema>;
export type AnalysisJob = typeof analysisJobs.$inferSelect;

// The structured segment type returned by analysis
export const segmentSchema = z.object({
  start: z.string(),
  end: z.string(),
  shortSummary: z.string(),
  detailedExplanation: z.string(),
  tags: z.string(),
  rating: z.number().min(1).max(3), // 1=🔥, 2=🔥🔥, 3=🔥🔥🔥
  ratingReason: z.string(),
  suggestedFormat: z.enum([
    "short-form clip",
    "LinkedIn post",
    "Twitter/X post",
    "quote graphic",
    "not useful",
  ]),
});

export type Segment = z.infer<typeof segmentSchema>;

// Standalone quotes extracted from the video
export const quoteSchema = z.object({
  timestamp: z.string(), // MM:SS
  quote: z.string(),
});

export type Quote = z.infer<typeof quoteSchema>;

// The combined result returned by analysis
export const analysisResultSchema = z.object({
  segments: z.array(segmentSchema),
  quotes: z.array(quoteSchema),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
