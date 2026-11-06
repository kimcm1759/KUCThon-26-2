"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "카메라", icon: "/figma/tab-camera.svg", w: 32, h: 32 },
  { href: "/collection", label: "내 모음", icon: "/figma/tab-gallery.svg", w: 36, h: 36 },
  { href: "/network", label: "네트워크", icon: "/figma/tab-people.svg", w: 31, h: 29 },
  { href: "/settings", label: "설정", icon: "/figma/tab-settings.svg", w: 36, h: 36 },
];

/** Bottom tab bar (Figma 버튼 / Group 8): 36px icons 64px apart, 12px labels, active in primary blue. */
export default function TabBar() {
  const path = usePathname();
  return (
    <nav className="pad-bottom shrink-0 pt-[10px]">
      <ul className="flex h-[57px] items-start justify-center gap-[64px]">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex w-9 flex-col items-center gap-[7px] ${active ? "text-primary" : "text-white"}`}
              >
                <span className="flex size-9 items-center justify-center">
                  <span
                    className="icon-mask block"
                    style={{ "--icon": `url(${t.icon})`, width: t.w, height: t.h } as React.CSSProperties}
                  />
                </span>
                <span className="whitespace-nowrap text-[12px] tracking-[0.6px]">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
