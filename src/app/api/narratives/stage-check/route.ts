import { connection } from "next/server";
import { stageCheck } from "@/lib/analysis/narratives";
import { errorResponse } from "@/lib/server/http";

/** GET → how narrative stages held up over their whole history: stability and what followed each change. */
export async function GET() {
  await connection();
  try {
    return Response.json(await stageCheck());
  } catch (err) {
    return errorResponse(err);
  }
}
