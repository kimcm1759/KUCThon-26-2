import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { filePath } from "@/lib/store";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  glb: "model/gltf-binary",
};

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[id]/[name]">) {
  const { id, name } = await ctx.params;
  try {
    const data = await readFile(filePath(id, name));
    const ext = name.split(".").pop()!.toLowerCase();
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
