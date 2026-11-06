"use client";

import { useEffect, useState } from "react";
import ObjectCard from "@/components/ui/ObjectCard";
import ScreenHeader from "@/components/ui/ScreenHeader";
import ShareCollectionDialog from "@/components/ui/ShareCollectionDialog";
import { useJobs } from "@/lib/useJobs";
import { useUser } from "@/lib/useUser";
import type { NetworkPost } from "@/lib/types";

export default function Network() {
  const jobs = useJobs();
  const user = useUser();
  const [posts, setPosts] = useState<NetworkPost[] | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const sharedIds = new Set(posts?.filter((post) => !post.isDefault && post.ownerId === user?.id).map((post) => post.jobId));

  async function deletePost(post: NetworkPost) {
    if (!user || post.isDefault || post.ownerId !== user.id || deleting) return;
    if (!window.confirm("이 게시물을 삭제할까요? 내 모음의 원본 사진은 그대로 남아요.")) return;
    setDeleting(post.id);
    setActionError("");
    try {
      const response = await fetch(`/api/network/${encodeURIComponent(post.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "삭제하지 못했어요.");
      setPosts((current) => current?.filter((item) => item.id !== post.id) ?? []);
      setNotice("게시물을 삭제했어요.");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "삭제하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/network", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("네트워크 사진을 불러오지 못했어요.");
        return response.json() as Promise<NetworkPost[]>;
      })
      .then(setPosts)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "사진을 불러오지 못했어요.");
      });
    return () => controller.abort();
  }, [reload]);

  return (
    <>
      <ScreenHeader
        title="네트워크"
        action={
          <button type="button" aria-label="내 모음에서 올리기" onClick={() => { setNotice(""); setPicking(true); }} disabled={posts === null} className="size-9 rounded-full disabled:opacity-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/figma/network-plus.svg" alt="" width={36} height={36} className="block" />
          </button>
        }
      />
      <section className="min-h-0 flex-1 overflow-y-auto pl-[23px] pr-[21px] pt-[29px] pb-6">
        {notice && <p role="status" className="mb-3 text-[13px] text-subtle">{notice}</p>}
        {actionError && <p role="alert" className="mb-3 text-[13px] text-red-400">{actionError}</p>}
        {error ? (
          <div role="alert" className="rounded-[16px] bg-surface p-5 text-center text-[14px] text-subtle">
            <p>{error}</p>
            <button type="button" onClick={() => { setError(""); setReload((value) => value + 1); }} className="mt-3 text-primary">다시 불러오기</button>
          </div>
        ) : posts === null ? (
          <div aria-label="네트워크 사진 불러오는 중" role="status" className="h-[231px] animate-pulse rounded-[16px] bg-surface" />
        ) : posts.length === 0 ? (
          <p className="rounded-[16px] bg-surface p-10 text-center text-[14px] text-subtle">아직 올라온 사진이 없어요.</p>
        ) : (
          <ul aria-label="네트워크 사진" className="flex flex-col gap-[14px]">
            {posts.map((post) => (
              <li key={post.id} className="relative">
                <ObjectCard job={post.job} owner={post.sharedBy} date={post.createdAt} wide />
                {!post.isDefault && user && post.ownerId === user.id && (
                  <button
                    type="button"
                    aria-label={`${post.job.verify.result?.label_ko ?? "사진"} 게시물 삭제`}
                    title="게시물 삭제"
                    disabled={deleting !== null}
                    onClick={() => deletePost(post)}
                    className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-black/65 text-white/80 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
                  >
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {picking && (
        <ShareCollectionDialog
          jobs={jobs}
          sharedIds={sharedIds}
          onClose={() => setPicking(false)}
          onShared={(post) => {
            setPosts((current) => [post, ...(current ?? []).filter((item) => item.id !== post.id)]);
            setPicking(false);
            setNotice("네트워크에 사진을 올렸어요.");
          }}
        />
      )}
    </>
  );
}
