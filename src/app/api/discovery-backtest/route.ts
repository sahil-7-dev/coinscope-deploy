import { connection, type NextRequest } from "next/server";
import { gitState, latestDiscoveryRun, runDiscoveryH0, type DiscoveryRun } from "@/lib/analysis/discovery-backtest";
import { errorResponse } from "@/lib/server/http";
import { getJob, startJob } from "@/lib/server/jobs";

/** GET ?id=… → job progress/result. GET alone → the latest saved H0 run (or null). */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const job = getJob<DiscoveryRun>(id);
      return job ? Response.json(job) : Response.json({ error: "Run not found (the server may have restarted)" }, { status: 404 });
    }
    return Response.json({ latest: await latestDiscoveryRun() });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST { rerunReason? } → starts the H0 run. Refuses unless the working tree is clean (the run must be
 * pinned to a commit), and refuses a second run unless a reason is given, which the report records.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { rerunReason?: unknown };
    const rerunReason = typeof body.rerunReason === "string" && body.rerunReason.trim() ? body.rerunReason.trim() : null;
    const git = gitState();
    if (git.dirty !== false) return Response.json({ error: "Commit the harness first: H0 must run from a clean, recorded commit." }, { status: 409 });
    const previous = await latestDiscoveryRun();
    if (previous && !rerunReason) {
      return Response.json({ error: `H0 already ran at ${previous.ranAt} (commit ${previous.harness.commit}). Pass rerunReason to run again; it's recorded in the report.` }, { status: 409 });
    }
    const job = startJob("discovery-h0", (report) => runDiscoveryH0({ rerunReason }, report));
    return Response.json({ id: job.id, status: job.status });
  } catch (err) {
    return errorResponse(err);
  }
}
