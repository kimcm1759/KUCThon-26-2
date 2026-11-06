import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Verification } from "./types";

const VerificationSchema = z.object({
  ok: z.boolean().describe("true if there is exactly one clear main object suitable for 3D reconstruction"),
  reason: z.string().describe("한국어 한두 문장: 판정 이유"),
  retake_tip: z.string().describe("한국어: ok가 false일 때 재촬영 방법, ok면 빈 문자열"),
  label_en: z
    .string()
    .describe("short English noun phrase for a segmentation text prompt, e.g. 'white ceramic mug'"),
  label_ko: z.string().describe("한국어 물건 이름"),
  surface_en: z
    .string()
    .describe("short English phrase for what the object rests on, e.g. 'light oak desk'"),
  material: z.enum([
    "glass",
    "ceramic",
    "metal",
    "wood",
    "plastic",
    "fabric",
    "paper",
    "rubber",
    "stone",
    "electronics",
    "food",
    "other",
  ]),
  fragility: z
    .enum(["shatters", "cracks", "dents", "bends", "tears", "squishes"])
    .describe("how this object would most plausibly break"),
  est_size_cm: z.object({ w: z.number(), h: z.number(), d: z.number() }),
  bbox: z
    .object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() })
    .describe("main object's box, each value normalized 0-1 relative to image width/height"),
  camera_elevation_deg: z
    .number()
    .describe("camera angle above the surface the object rests on: 0 = eye level, 90 = straight down"),
  difficulty_notes: z
    .string()
    .describe("한국어: 투명/반사/얇은 부분/잘림 등 3D 생성이 어려울 요소, 없으면 빈 문자열"),
});

const SYSTEM = `You check photos for an app that turns one real-world object into a 3D model the user can smash.
Pass (ok=true) only when one object is clearly the subject: mostly inside the frame, in focus, not heavily occluded.
Background clutter is fine as long as the main object is obvious. People, pets, screens showing other images, and
scenery with no single object fail. Write reason, retake_tip, label_ko and difficulty_notes in Korean.`;

// Created on first use so a missing key surfaces as a job error, not an import crash.
let client: Anthropic | null = null;

export async function verifyPhoto(jpeg: Buffer): Promise<Verification> {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
          },
          { type: "text", text: "Check this photo." },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(VerificationSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`verification refused: ${response.stop_details?.explanation ?? "no details"}`);
  }
  if (!response.parsed_output) {
    throw new Error(`verification returned no parsable output (stop_reason=${response.stop_reason})`);
  }
  return response.parsed_output;
}
