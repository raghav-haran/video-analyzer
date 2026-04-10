import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Schema for analysis jobs
export const analysisJobs = sqliteTable("analysis_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  driveUrl: text("drive_url").notNull(),
  status: text("status").notNull().default("pending"), // pending, downloading, transcribing, analyzing, complete, error
  statusMessage: text("status_message"),
  result: text("result"), // JSON string of Segment[]
  createdAt: text("created_at").notNull(),
});

export const insertJobSchema = createInsertSchema(analysisJobs).pick({
  driveUrl: true,
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
  clipQualityScore: z.number().min(1).max(10),
  scoreReason: z.string(),
  suggestedFormat: z.enum([
    "short-form clip",
    "LinkedIn post",
    "Twitter/X post",
    "quote graphic",
    "not useful",
  ]),
});

export type Segment = z.infer<typeof segmentSchema>;
