"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { uploadPhoto } from "@/lib/client";
import type { Job } from "@/lib/types";
import { CAMERA_MESSAGE, useCamera } from "@/lib/useCamera";

const ZOOMS = [0.5, 1, 2, 5];

/**
 * Full-screen camera (Figma 카메라2). Shutter grabs the live frame and uploads
 * it; the thumbnail picks from the gallery; without live camera access (plain
 * http, denied) the shutter falls back to the phone's own camera app.
 */
export default function CameraPage() {
  const router = useRouter();
  const nativeInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const { video, state, track } = useCamera(facing);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((jobs: Job[]) => setThumb(jobs.find((j) => !j.sharedBy && !j.draft)?.photo.url ?? null))
      .catch(() => {});
  }, []);

  // Real lens zoom when the camera offers it, otherwise a centre crop.
  const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: { min: number; max: number } };
  const lensZoom = caps.zoom;
  const digital = lensZoom ? 1 : Math.max(1, zoom);
  useEffect(() => {
    if (!track || !lensZoom) return;
    const z = Math.min(lensZoom.max, Math.max(lensZoom.min, zoom));
    track.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }).catch(() => {});
  }, [track, lensZoom, zoom]);

  async function send(photo: Blob) {
    setBusy(true);
    setError(null);
    try {
      const id = await uploadPhoto(photo, { draft: true });
      router.push(`/jobs/${id}/play`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function shoot() {
    const v = video.current;
    if (state !== "live" || !v || !v.videoWidth) return nativeInput.current?.click();
    const w = v.videoWidth / digital;
    const h = v.videoHeight / digital;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    canvas.getContext("2d")!.drawImage(v, (v.videoWidth - w) / 2, (v.videoHeight - h) / 2, w, h, 0, 0, w, h);
    canvas.toBlob((b) => b && send(b), "image/jpeg", 0.95);
  }

  const pick = (file: File | undefined) => file && send(file);

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white select-none">
      <video
        ref={video}
        playsInline
        muted
        className="absolute inset-0 size-full object-cover transition-transform"
        style={{ transform: `scale(${digital}) ${facing === "user" ? "scaleX(-1)" : ""}` }}
      />
      {state !== "live" && state !== "starting" && (
        <p className="absolute inset-x-8 top-1/2 -translate-y-1/2 text-center text-[14px] text-subtle">
          {CAMERA_MESSAGE[state]}
          <br />
          <span className="text-[12px] text-muted">셔터를 누르면 기본 카메라로 찍어요</span>
        </p>
      )}

      {/* Top row: back, iOS-style quick settings pill. */}
      <div className="pad-top absolute inset-x-0 top-0">
        <div className="relative -mt-[11px] h-[52px]">
          <div className="absolute top-[10px] right-[16px] h-[33px] w-[99px] rounded-[16px] bg-[#313131]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/figma/cam-topbar.png" alt="" className="pointer-events-none absolute inset-0 h-[52px] w-full object-cover" />
          <button
            onClick={() => router.back()}
            aria-label="뒤로"
            className="absolute top-[14px] left-[16px] size-6"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/figma/back.svg" alt="" width={24} height={24} className="block" />
          </button>
        </div>
      </div>

      {/* Zoom row, 152px above the bottom edge. */}
      <div className="absolute inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),27px)+125px)] h-9">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/figma/cam-macro.png" alt="" className="absolute left-[29px] size-9 rounded-[18px]" />
        <div className="absolute left-1/2 flex -translate-x-1/2 gap-1">
          <span className="size-9" />
          {ZOOMS.map((z) => {
            const active = z === zoom;
            const label = String(z).replace(/^0/, "");
            return (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`relative flex size-9 items-center justify-center text-[16px] leading-[22px] ${
                  active ? "text-zoom" : "text-white"
                }`}
              >
                {active && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/figma/cam-zoom-active.svg" alt="" className="absolute inset-0 size-9" />
                )}
                <span className="relative">{active ? `${label}x` : label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom row: gallery, shutter, flip. */}
      <div className="absolute inset-x-0 bottom-[max(env(safe-area-inset-bottom),27px)] flex h-[72px] items-center justify-center gap-[88px]">
        <button
          onClick={() => galleryInput.current?.click()}
          aria-label="갤러리에서 고르기"
          className="size-12 overflow-hidden rounded-[32px] bg-[#313131]"
        >
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="size-full object-cover" />
          )}
        </button>
        <button onClick={shoot} disabled={busy} aria-label="촬영" className="relative size-[72px] disabled:opacity-60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/figma/cam-shutter-ring.svg" alt="" className="absolute inset-0 size-[72px]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/figma/cam-shutter.svg" alt="" className="absolute top-1 left-1 size-16" />
        </button>
        <button
          onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          aria-label="카메라 전환"
          className="glass relative flex size-12 items-center justify-center rounded-[24px] bg-[rgba(31,31,31,0.2)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/figma/cam-flip.svg" alt="" width={23.15} height={18} />
        </button>
      </div>

      {(busy || error) && (
        <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-[16px] bg-surface/95 p-5 text-center text-[14px]">
          {busy ? "사진을 보내는 중…" : error}
          {error && (
            <button onClick={() => setError(null)} className="mt-3 block w-full text-[12px] text-primary">
              닫기
            </button>
          )}
        </div>
      )}

      <input ref={nativeInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <input ref={galleryInput} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </main>
  );
}
