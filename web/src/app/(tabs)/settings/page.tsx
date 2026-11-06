"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ScreenHeader from "@/components/ui/ScreenHeader";
import { setUser, signOut } from "@/lib/client";
import { userChanged, useUser } from "@/lib/useUser";

/** 설정 (not designed yet): account and a way back to onboarding, in the same card style. */
export default function Settings() {
  const router = useRouter();
  const user = useUser();
  const [error, setError] = useState("");
  return (
    <>
      <ScreenHeader title="설정" />
      <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[25px] pt-[29px] pb-6">
        <div className="rounded-[16px] bg-surface p-5">
          <p className="text-[12px] tracking-[0.6px] text-muted">닉네임</p>
          <p className="mt-1 text-[18px] font-medium">{user?.nickname}</p>
          {user?.email && <div className="mt-4"><p className="text-[12px] tracking-[0.6px] text-muted">이메일</p><p className="mt-1 break-all text-[14px] text-subtle">{user.email}</p></div>}
        </div>
        <button
          onClick={async () => {
            try {
              await signOut();
              setUser(null);
              userChanged();
              router.replace("/onboarding");
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "로그아웃하지 못했어요.");
            }
          }}
          className="flex h-14 items-center justify-center rounded-[16px] bg-surface text-[16px] text-primary"
        >
          로그아웃
        </button>
        {error && <p role="alert" className="text-[13px] text-red-400">{error}</p>}
        <Link href="/dev" className="mt-auto text-center text-[12px] text-muted underline">
          개발자 화면 (파이프라인 결과)
        </Link>
      </section>
    </>
  );
}
