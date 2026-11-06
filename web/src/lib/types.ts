export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

/** Normalized box, 0-1 relative to the photo. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Verification {
  ok: boolean;
  reason: string;
  retake_tip: string;
  label_en: string;
  label_ko: string;
  surface_en: string;
  material: string;
  fragility: string;
  est_size_cm: { w: number; h: number; d: number };
  bbox: Box;
  camera_elevation_deg: number;
  difficulty_notes: string;
}

/** One model's attempt at a step (a background or a 3D model). */
export interface Candidate {
  id: string;
  label: string;
  status: StepStatus;
  /** Same-origin URL of the saved result. */
  url?: string;
  error?: string;
  ms?: number;
}

export interface Alignment {
  fov: number;
  elevation: number;
  yaw: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  light: number;
}

export interface Job {
  id: string;
  createdAt: string;
  status: "running" | "done" | "rejected" | "error";
  error?: string;
  photo: { url: string; width: number; height: number };
  verify: { status: StepStatus; result?: Verification; error?: string; ms?: number };
  mask: {
    status: StepStatus;
    url?: string;
    cutoutUrl?: string;
    /** Tight box of the mask, normalized. */
    bbox?: Box;
    source?: string;
    error?: string;
    ms?: number;
  };
  backgrounds: Candidate[];
  models: Candidate[];
  selection: { background?: string; model?: string };
  alignment?: Alignment;
  note?: string;
}
