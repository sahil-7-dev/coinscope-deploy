import { connection } from "next/server";
import { getNarratives } from "@/lib/analysis/narratives";
import { errorResponse } from "@/lib/server/http";

export async function GET() {
  await connection();
  try {
    return Response.json(await getNarratives());
  } catch (err) {
    return errorResponse(err);
  }
}
