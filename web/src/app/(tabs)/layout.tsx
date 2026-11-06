"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import TabBar from "@/components/ui/TabBar";
import { useUser } from "@/lib/useUser";

/** Screens with the bottom tab bar. Nobody signed in yet → onboarding first. */
export default function TabsLayout({ children }: LayoutProps<"/">) {
  const router = useRouter();
  const user = useUser();

  useEffect(() => {
    if (user === null) router.replace("/onboarding");
  }, [user, router]);

  return (
    <div className="fixed inset-0 flex flex-col bg-bg">
      {/* Rendered either way (instant navigation needs the segment); hidden until we know who it is. */}
      <div className={`flex min-h-0 flex-1 flex-col ${user ? "" : "invisible"}`}>{children}</div>
      <TabBar />
    </div>
  );
}
