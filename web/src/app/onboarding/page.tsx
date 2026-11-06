"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Stage from "@/components/ui/Stage";
import { setUser, signIn, type User } from "@/lib/client";
import { DEMO_PASSWORD, DEMO_USER, GUEST_USER, socialUser } from "@/lib/profile";
import { userChanged } from "@/lib/useUser";

const DEMO_ACCOUNT = {
  ...DEMO_USER,
  password: DEMO_PASSWORD,
} as const;

/**
 * Onboarding (Figma 온보딩): splash with the 빠각 logo, then a login form.
 * Email sign-in uses a fixed demo account until real accounts are connected.
 */
export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<"splash" | "login">("splash");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const enter = async (user: User, enteredPassword?: string) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const profile = await signIn(user, enteredPassword);
      setUser(profile);
      userChanged();
      setPassword("");
      router.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  };
  const guest = () => enter(GUEST_USER);
  const ready = email.trim() !== "" && password !== "";
  const backToSelection = () => {
    setStep("splash");
    setEmail("");
    setPassword("");
    setError("");
  };

  if (step === "splash") {
    return (
      <Stage className="bg-[linear-gradient(to_bottom,#18171c_57.692%,#625d72_93.269%,#878493)]">
        <div className="absolute top-[221px] left-[76px]">
          <p className="bg-[linear-gradient(to_bottom,#b8c5d7,#fff_67.788%)] bg-clip-text text-[128px] leading-[normal] font-black whitespace-nowrap text-transparent">
            빠각
          </p>
          <div className="absolute top-[119px] left-[227px] h-4 w-[21px] bg-primary" />
        </div>
        <Shards />
        <button
          onClick={() => setStep("login")}
          disabled={pending}
          className="glass absolute top-[750px] left-1/2 flex h-14 w-[352px] -translate-x-1/2 items-center justify-center rounded-[16px] bg-primary/40 text-[18px] font-medium tracking-[0.9px] transition-colors duration-300 hover:bg-surface/20 hover:text-primary"
        >
          로그인
        </button>
        <UnderlinedLink className="top-[818px]" onClick={guest} disabled={pending}>
          게스트로 로그인 할래요.
        </UnderlinedLink>
        {error && <p role="alert" className="absolute top-[842px] left-[25px] w-[352px] text-center text-[12px] text-red-400">{error}</p>}
      </Stage>
    );
  }

  const SOCIAL = [
    { via: "google", bg: "bg-white", img: "/figma/login-google.png", w: 39, h: 39, label: "Google" },
    { via: "apple", bg: "bg-black", img: "/figma/login-apple.png", w: 36, h: 42, label: "Apple" },
    { via: "kakao", bg: "bg-[#ffd300]", img: "/figma/login-kakao.png", w: 31, h: 28, label: "카카오" },
    { via: "naver", bg: "bg-[#00c300]", img: "/figma/login-naver.png", w: 49, h: 48, label: "네이버" },
  ] as const;

  return (
    <Stage className="bg-bg">
      <button
        type="button"
        onClick={backToSelection}
        disabled={pending}
        aria-label="로그인 방식 선택으로 돌아가기"
        className="absolute top-[15px] left-[15px] flex size-11 items-center justify-center rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/figma/back.svg" alt="" width={24} height={24} className="block" />
      </button>
      <button onClick={backToSelection} disabled={pending} className="absolute top-[202px] left-[159px]" aria-label="처음으로">
        <span className="text-[43.871px] leading-[normal] font-black whitespace-nowrap">빠각</span>
        <span className="absolute top-[40.79px] left-[77.8px] h-[5.484px] w-[7.198px] bg-primary" />
      </button>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;

          // TODO: Replace the demo check with account authentication when available.
          if (email.trim().toLowerCase() !== DEMO_ACCOUNT.email.toLowerCase() || password !== DEMO_ACCOUNT.password) {
            setError("이메일 또는 비밀번호가 올바르지 않아요. 다시 확인해 주세요.");
            return;
          }

          setError("");
          void enter(DEMO_USER, password);
        }}
      >
        <input
          type="email"
          name="email"
          aria-label="이메일"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
          placeholder="Email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          className="absolute top-[286px] left-[25px] h-14 w-[352px] rounded-[16px] bg-surface px-6 text-[16px] text-subtle outline-none placeholder:text-subtle aria-invalid:ring-1 aria-invalid:ring-red-400"
        />
        <input
          type="password"
          name="password"
          aria-label="비밀번호"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          placeholder="Password"
          autoComplete="current-password"
          className="absolute top-[358px] left-[25px] h-14 w-[352px] rounded-[16px] bg-surface px-6 text-[16px] text-subtle outline-none placeholder:text-subtle aria-invalid:ring-1 aria-invalid:ring-red-400"
        />
        <button
          type="submit"
          disabled={!ready || pending}
          className="absolute top-[430px] left-[25px] flex h-14 w-[352px] items-center justify-center rounded-[16px] bg-primary/20 text-[18px] font-medium tracking-[0.9px] text-white transition-colors duration-300 enabled:hover:bg-surface/20 enabled:hover:text-primary"
        >
          {pending ? "로그인 중…" : "로그인"}
        </button>
        {error && (
          <p id="login-error" role="alert" className="absolute top-[606px] left-[25px] w-[352px] text-center text-[12px] leading-5 text-red-400">
            {error}
          </p>
        )}
      </form>
      <div className="absolute top-[502px] left-[71px] flex gap-3">
        {SOCIAL.map((s) => (
          <button
            key={s.via}
            onClick={() => { const profile = socialUser(s.via); if (profile) void enter(profile); }}
            disabled={pending}
            aria-label={`${s.label}로 로그인`}
            className={`flex size-14 items-center justify-center rounded-[28px] ${s.bg}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.img} alt="" width={s.w} height={s.h} className="object-contain" style={{ width: s.w, height: s.h }} />
          </button>
        ))}
      </div>
      <UnderlinedLink className="top-[574px]" onClick={() => alert("계정 찾기는 아직 준비 중이에요.")}>
        아이디 / 비밀번호 찾기
      </UnderlinedLink>
    </Stage>
  );
}

function UnderlinedLink({ className, onClick, children, disabled }: { className: string; onClick: () => void; children: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`absolute left-1/2 flex -translate-x-1/2 flex-col ${className}`}>
      <span className="text-[12px] leading-[normal] tracking-[0.6px] whitespace-nowrap text-muted">{children}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/figma/underline.svg" alt="" className="h-px w-full" />
    </button>
  );
}

/** The flying shards on the splash, placed and rotated exactly as in the frame. */
function Shards() {
  const shards = [
    { src: "shard-1", box: [88.55, 361.43, 277.435, 292.394], rot: -58.77, size: [229.649, 185.2], inset: "-5.4% 2.34% 19.6% 2.34%" },
    { src: "shard-4", box: [16.99, 465.93, 58.602, 70.953], rot: -93.34, size: [67.882, 54.744], inset: "-7.31% 0.81% 17.69% 0.81%" },
    { src: "shard-5", box: [258.21, 550.69, 54.791, 59.632], rot: -106.98, size: [49.468, 42.181], inset: "-4.74% 2.66% 20.26% 2.66%" },
    { src: "shard-2", box: [18.67, 439.86, 257.561, 253.948], rot: -41.71, size: [203.431, 158.856], inset: "-1.26% 5.72% 23.74% 5.72%" },
    { src: "shard-3", box: [-53, 526.41, 213.656, 187.357], rot: -60.21, size: [111.483, 182.369], inset: "0 6.7% 25% 6.7%" },
  ];
  return shards.map((s) => (
    <div
      key={s.src}
      className="pointer-events-none absolute flex items-center justify-center"
      style={{ left: s.box[0], top: s.box[1], width: s.box[2], height: s.box[3] }}
    >
      <div className="flex-none" style={{ transform: `rotate(${s.rot}deg)` }}>
        <div className="relative" style={{ width: s.size[0], height: s.size[1] }}>
          <div className="absolute" style={{ inset: s.inset }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/figma/${s.src}.svg`} alt="" className="block size-full max-w-none" />
          </div>
        </div>
      </div>
    </div>
  ));
}
