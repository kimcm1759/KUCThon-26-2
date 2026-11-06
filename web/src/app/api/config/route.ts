import { connection } from "next/server";
import { READ_ONLY } from "@/lib/store";

/** What the client needs to know about this deployment. */
export async function GET() {
  // READ_ONLY comes from runtime env; don't let this be prerendered at build time.
  await connection();
  return Response.json({ readOnly: READ_ONLY });
}
