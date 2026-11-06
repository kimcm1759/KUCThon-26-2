"use client";

import { useEffect, useRef, useState } from "react";

export type CameraState = "starting" | "live" | "denied" | "unsupported" | "error";

/**
 * Live camera into a <video>. Asks for permission on first use; needs a
 * secure page (https or localhost) — over plain-http LAN it reports
 * "unsupported" and callers fall back to the phone's own camera app.
 */
export function useCamera(facing: "environment" | "user" = "environment") {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setState("unsupported");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const el = video.current;
        if (el) {
          el.srcObject = stream;
          await el.play().catch(() => {});
        }
        setTrack(stream.getVideoTracks()[0] ?? null);
        setState("live");
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : "";
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      }
    };
    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setTrack(null);
    };
  }, [video, facing]);

  return { video, state, track };
}

export const CAMERA_MESSAGE: Record<Exclude<CameraState, "starting" | "live">, string> = {
  denied: "카메라 권한을 허용해 주세요",
  unsupported: "이 화면에서는 카메라를 바로 열 수 없어요",
  error: "카메라를 켜지 못했어요",
};
