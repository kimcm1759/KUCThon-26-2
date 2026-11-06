"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import TabBar from "@/components/ui/TabBar";
import { useUser } from "@/lib/useUser";

/** Screens with the bottom tab bar. Nobody signed in yet → onboarding first. */
export default function TabsLayout({ children }: LayoutProps<"/">) {
  const router = useRouter();
  const path = usePathname();
  const user = useUser();

  useEffect(() => {
    if (user === null) router.replace("/onboarding");
  }, [user, router]);

  return (
    <div className="fixed inset-0 flex flex-col bg-bg">
      {/* Rendered either way (instant navigation needs the segment); hidden until we know who it is. */}
      <div className={`flex min-h-0 flex-1 flex-col ${user ? "" : "invisible"}`}>{children}</div>
      {/* Figma 내 모음 / 네트워크 / 업적 (Rectangle 12): lists fade into a lighter band behind the tabs. */}
      {path !== "/" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[263px] bg-[linear-gradient(to_bottom,rgba(24,23,28,0)_0%,rgba(39,37,46,0.81)_62.5%,rgba(74,70,90,0.81)_100%)]" />
      )}
      <div className="relative">
        <TabBar />
      </div>
    </div>
  );
}
