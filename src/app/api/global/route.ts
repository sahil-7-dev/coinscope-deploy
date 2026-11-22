import { connection } from "next/server";
import { getGlobalStats } from "@/lib/analysis/market";
import { errorResponse } from "@/lib/server/http";

export async function GET() {
  await connection();
  try {
    return Response.json(await getGlobalStats());
  } catch (err) {
    return errorResponse(err);
  }
}
