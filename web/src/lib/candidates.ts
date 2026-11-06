import "server-only";

/**
 * fal.ai endpoints compared side by side for each photo. Ids, params and
 * prices were read from the fal.ai model pages on 2026-11-06.
 */

export interface CandidateContext {
  photoUrl: string;
  /** Tight object mask (white = object). */
  maskUrl: string;
  /** Mask grown over edges and the contact shadow, for erasing. */
  eraseMaskUrl: string;
  /** Object on transparent background, padded square. */
  cutoutUrl: string;
  label: string;
  surface: string;
}

export interface CandidateDef {
  id: string;
  label: string;
  endpoint: string;
  input: (c: CandidateContext) => Record<string, unknown>;
  /** Pull the result file URL out of the endpoint's response. */
  output: (data: FalData) => string | undefined;
}

// Responses differ per endpoint; each output() reads only what it needs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FalData = any;

/**
 * Which candidates run, as comma-separated ids. Defaults to one of each to
 * keep test runs cheap; set CANDIDATES=all in .env.local to compare them all.
 */
const ACTIVE = (process.env.CANDIDATES ?? "bria-eraser,trellis2").split(",").map((s) => s.trim());
const active = (defs: CandidateDef[]) =>
  ACTIVE.includes("all") ? defs : defs.filter((d) => ACTIVE.includes(d.id));

const ALL_BACKGROUNDS: CandidateDef[] = [
  {
    id: "flux-fill",
    label: "FLUX.1 Fill [pro] · ~$0.10",
    endpoint: "fal-ai/flux-pro/v1/fill",
    input: (c) => ({
      image_url: c.photoUrl,
      mask_url: c.eraseMaskUrl,
      prompt: `empty ${c.surface}, seamless natural continuation of the surrounding background, nothing on it`,
      output_format: "png",
      safety_tolerance: "2",
    }),
    output: (d) => d.images?.[0]?.url,
  },
  {
    id: "bria-eraser",
    label: "Bria Eraser · $0.04",
    endpoint: "fal-ai/bria/eraser",
    input: (c) => ({ image_url: c.photoUrl, mask_url: c.eraseMaskUrl, mask_type: "manual" }),
    output: (d) => d.image?.url,
  },
  {
    id: "finegrain",
    label: "Finegrain Eraser · $0.13",
    endpoint: "fal-ai/finegrain-eraser/mask",
    input: (c) => ({ image_url: c.photoUrl, mask_url: c.eraseMaskUrl, mode: "standard" }),
    output: (d) => d.image?.url,
  },
  {
    id: "kontext",
    label: "FLUX Kontext [pro] (지시형) · $0.04",
    endpoint: "fal-ai/flux-pro/kontext",
    input: (c) => ({
      image_url: c.photoUrl,
      prompt: `Remove the ${c.label} and its shadow completely. Keep everything else exactly the same.`,
      output_format: "png",
    }),
    output: (d) => d.images?.[0]?.url,
  },
];

const ALL_MODELS: CandidateDef[] = [
  {
    id: "trellis2",
    label: "TRELLIS.2 · $0.30",
    endpoint: "fal-ai/trellis-2",
    input: (c) => ({
      image_url: c.cutoutUrl,
      resolution: 1024,
      texture_size: 2048,
      // Default is 500k faces — too heavy for a phone browser.
      decimation_target: 150000,
    }),
    output: (d) => d.model_glb?.url,
  },
  {
    id: "rodin2",
    label: "Rodin Gen-2 · $0.40",
    endpoint: "fal-ai/hyper3d/rodin/v2",
    input: (c) => ({
      input_image_urls: [c.cutoutUrl],
      geometry_file_format: "glb",
      material: "PBR",
      quality_mesh_option: "150K Triangle",
      use_original_alpha: true,
    }),
    output: (d) => d.model_mesh?.url,
  },
  {
    id: "tripo",
    label: "Tripo H3.1 · $0.30",
    endpoint: "tripo3d/h3.1/image-to-3d",
    input: (c) => ({ image_url: c.cutoutUrl, texture: true, pbr: true, face_limit: 150000 }),
    output: (d) => d.model_urls?.pbr_model?.url ?? d.model_urls?.glb?.url ?? d.model_mesh?.url,
  },
  {
    id: "sam3d",
    label: "SAM 3D Objects · $0.02",
    endpoint: "fal-ai/sam-3/3d-objects",
    input: (c) => ({ image_url: c.photoUrl, mask_urls: [c.maskUrl], export_textured_glb: true }),
    output: (d) => d.model_glb?.url,
  },
];

export const BACKGROUNDS = active(ALL_BACKGROUNDS);
export const MODELS = active(ALL_MODELS);
