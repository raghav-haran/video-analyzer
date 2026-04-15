import { analysisJobs, type AnalysisJob, type InsertJob } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  createJob(driveUrl: string, dateFilmed?: string): AnalysisJob;
  getJob(id: number): AnalysisJob | undefined;
  getAllJobs(): AnalysisJob[];
  updateJobStatus(id: number, status: string, statusMessage?: string): void;
  updateJobResult(id: number, result: string): void;
}

export class DatabaseStorage implements IStorage {
  createJob(driveUrl: string, dateFilmed?: string): AnalysisJob {
    return db
      .insert(analysisJobs)
      .values({
        driveUrl,
        dateFilmed: dateFilmed || null,
        status: "pending",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
  }

  getJob(id: number): AnalysisJob | undefined {
    return db.select().from(analysisJobs).where(eq(analysisJobs.id, id)).get();
  }

  getAllJobs(): AnalysisJob[] {
    return db.select().from(analysisJobs).all();
  }

  updateJobStatus(id: number, status: string, statusMessage?: string): void {
    db.update(analysisJobs)
      .set({ status, statusMessage: statusMessage || null })
      .where(eq(analysisJobs.id, id))
      .run();
  }

  updateJobResult(id: number, result: string): void {
    db.update(analysisJobs)
      .set({ status: "complete", result })
      .where(eq(analysisJobs.id, id))
      .run();
  }
}

export const storage = new DatabaseStorage();
