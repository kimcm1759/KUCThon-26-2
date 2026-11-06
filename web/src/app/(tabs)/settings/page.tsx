"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import ScreenHeader from "@/components/ui/ScreenHeader";
import { setUser } from "@/lib/client";
import { userChanged, useUser } from "@/lib/useUser";

/** 설정 (not designed yet): account and a way back to onboarding, in the same card style. */
export default function Settings() {
  const router = useRouter();
  const user = useUser();
  return (
    <>
      <ScreenHeader title="설정" />
      <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[25px] pt-[29px] pb-6">
        <div className="rounded-[16px] bg-surface p-5">
          <p className="text-[12px] tracking-[0.6px] text-muted">로그인한 계정</p>
          <p className="mt-1 text-[18px] font-medium">{user?.name}</p>
        </div>
        <button
          onClick={() => {
            setUser(null);
            userChanged();
            router.replace("/onboarding");
          }}
          className="flex h-14 items-center justify-center rounded-[16px] bg-surface text-[16px] text-primary"
        >
          로그아웃
        </button>
        <Link href="/dev" className="mt-auto text-center text-[12px] text-muted underline">
          개발자 화면 (파이프라인 결과)
        </Link>
      </section>
    </>
  );
}
