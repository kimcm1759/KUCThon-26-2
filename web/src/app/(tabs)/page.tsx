"use client";

import Link from "next/link";
import ScreenHeader from "@/components/ui/ScreenHeader";
import { CAMERA_MESSAGE, useCamera } from "@/lib/useCamera";

/** 카메라 tab (Figma 카메라): live preview in a rounded card; tap it to open the full camera. */
export default function CameraTab() {
  const { video, state } = useCamera();

  return (
    <>
      <ScreenHeader />
      <Link
        href="/camera"
        aria-label="촬영하기"
        className="relative mx-auto mt-[14px] mb-9 block w-[calc(100%-31px)] max-w-[371px] flex-1 overflow-hidden rounded-[24px] bg-black/66"
      >
        <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />
        {state !== "live" && state !== "starting" && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center text-[14px] text-subtle">
            {CAMERA_MESSAGE[state]}
            <span className="text-[12px] text-muted">눌러서 촬영 화면으로</span>
          </span>
        )}
      </Link>
    </>
  );
}
