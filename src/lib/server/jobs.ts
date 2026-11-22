// Minimal background jobs for work that takes minutes (big backtests): the
// request starts the job and returns its id, the page polls for progress.
// Lives on globalThis so it survives hot reloads in dev.

export interface JobProgress {
  stage: string;
  done: number;
  total: number;
}

export interface Job<T> {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
  progress: JobProgress;
  startedAt: string;
  result?: T;
  error?: string;
}

const g = globalThis as unknown as { __jobs?: Map<string, Job<unknown>> };
const jobs = (g.__jobs ??= new Map());

/** Starts `work` unless a job of the same kind is already running, in which case that one is returned. */
export function startJob<T>(kind: string, work: (report: (p: JobProgress) => void) => Promise<T>): Job<T> {
  const running = [...jobs.values()].find((j) => j.kind === kind && j.status === "running");
  if (running) return running as Job<T>;

  const job: Job<T> = {
    id: `${kind}-${Date.now().toString(36)}`,
    kind,
    status: "running",
    progress: { stage: "Starting", done: 0, total: 0 },
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  work((p) => (job.progress = p))
    .then((result) => {
      job.result = result;
      job.status = "done";
    })
    .catch((err) => {
      job.error = err instanceof Error ? err.message : String(err);
      job.status = "error";
      console.error(`[job ${job.id}]`, job.error);
    });
  return job;
}

export function getJob<T>(id: string): Job<T> | undefined {
  return jobs.get(id) as Job<T> | undefined;
}
