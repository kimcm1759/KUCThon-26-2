"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/types";

/** Shrink on the device before upload: phone photos are 4–12 MB, the pipeline uses ≤1536px. */
async function shrink(file: File, max = 1536): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 변환 실패"))), "image/jpeg", 0.92),
  );
}

const STATUS_LABEL: Record<Job["status"], string> = {
  running: "생성 중",
  done: "완료",
  rejected: "검증 탈락",
  error: "오류",
};

export default function Home() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then(setJobs)
      .catch(() => {});
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", await shrink(file), "photo.jpg");
      const res = await fetch("/api/jobs", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `업로드 실패 (${res.status})`);
      router.push(`/jobs/${body.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold">부숴봐</h1>
        <p className="mt-1 text-sm text-neutral-400">
          물건 사진 한 장 → 물체 분리 → 빈 배경 + 3D 모델 (파이프라인 테스트)
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <button
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          className="rounded-2xl bg-orange-500 py-5 text-lg font-semibold text-black disabled:opacity-50"
        >
          {busy ? "업로드 중…" : "카메라로 찍기"}
        </button>
        <button
          disabled={busy}
          onClick={() => uploadRef.current?.click()}
          className="rounded-2xl border border-neutral-700 py-3 text-neutral-200 disabled:opacity-50"
        >
          사진 업로드
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <p className="text-xs leading-relaxed text-neutral-500">
          팁: 물건 하나가 화면의 1/3 이상 차지하게, 살짝 위에서 내려다보는 각도로 찍으면 결과가 가장
          좋아요. 유리·거울처럼 투명하거나 반사되는 물건은 어려워요.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">수집 일기</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-neutral-500">아직 찍은 물건이 없어요.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}`} className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={job.photo.url}
                    alt=""
                    className="aspect-square w-full rounded-xl object-cover"
                  />
                  <p className="mt-1 truncate text-xs text-neutral-300">
                    {job.verify.result?.label_ko ?? "확인 중"}
                  </p>
                  <p className="text-[10px] text-neutral-500">
                    {STATUS_LABEL[job.status]} · {new Date(job.createdAt).toLocaleDateString("ko-KR")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
