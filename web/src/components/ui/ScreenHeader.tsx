import Link from "next/link";
import type { ReactNode } from "react";

/** Page title at 24px SemiBold with the account button on the right (Figma 내 모음 / 네트워크). */
export default function ScreenHeader({ title, action }: { title?: string; action?: ReactNode }) {
  return (
    <header className="pad-top flex shrink-0 items-center justify-between pr-[18px] pl-[25px]">
      <h1 className="text-[24px] leading-9 font-semibold tracking-[1.2px]">{title}</h1>
      <div className="flex items-center gap-[11px]">
        {action}
        <Link href="/settings" aria-label="내 계정">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/figma/account.svg" alt="" width={36} height={36} className="block size-9" />
        </Link>
      </div>
    </header>
  );
}
