import { connection } from "next/server";
import { getMarketPulse } from "@/lib/analysis/market";
import { errorResponse } from "@/lib/server/http";

export async function GET() {
  await connection();
  try {
    return Response.json(await getMarketPulse());
  } catch (err) {
    return errorResponse(err);
  }
}
