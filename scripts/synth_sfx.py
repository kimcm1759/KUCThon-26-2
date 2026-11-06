"""도구별 효과음 오프라인 합성기.

5개 도구 x 4개 역할 = 20개 WAV를 assets/audio/tools/{tool}/{role}_001.wav 로 만들고
sounds/catalog.json 과 sounds/README.md 를 갱신한다.
참고 페이지의 오디오/코드는 사용하지 않은 독자 합성이다.

실행: python scripts/synth_sfx.py   (프로젝트 루트에서)
"""
import json
import math
import os
import wave
from datetime import date

import numpy as np

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rng = np.random.default_rng(20261107)


# ---------- 기본 도구 ----------
def n_of(d):
    return int(d * SR)


def tvec(d):
    return np.arange(n_of(d)) / SR


def noise(d):
    return rng.standard_normal(n_of(d))


def band(x, lo=None, hi=None, soft=0.15):
    """FFT 기반 대역 필터 (부드러운 경계)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.ones_like(f)
    if lo:
        m *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** (2 / soft * 0.3))
    if hi:
        m *= 1 / (1 + (f / hi) ** (2 / soft * 0.3))
    return np.fft.irfft(X * m, len(x))


def svf_bp(x, fc, q=2.0):
    """시간에 따라 중심 주파수가 변하는 상태변수 밴드패스. fc는 배열."""
    y = np.zeros_like(x)
    low = bp = 0.0
    fc = np.broadcast_to(fc, x.shape)
    for i in range(len(x)):
        f = 2 * math.sin(math.pi * min(fc[i], SR / 6) / SR)
        hp = x[i] - low - bp / q
        bp += f * hp
        low += f * bp
        y[i] = bp
    return y


def osc(freq, d, shape="sine"):
    fr = np.broadcast_to(freq, (n_of(d),)).astype(float)
    ph = np.cumsum(2 * np.pi * fr / SR)
    if shape == "sine":
        return np.sin(ph)
    if shape == "saw":
        return 2 * ((ph / (2 * np.pi)) % 1.0) - 1
    if shape == "square":
        return np.sign(np.sin(ph))
    raise ValueError(shape)


def exp_env(d, tau, delay=0.0):
    t = tvec(d)
    e = np.exp(-np.maximum(t - delay, 0) / tau)
    e[t < delay] = 0
    return e


def ar_env(d, attack, release):
    t = tvec(d)
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.clip((d - t) / max(release, 1e-4), 0, 1)
    return a * r


def place(buf, snd, at):
    i = int(at * SR)
    j = min(len(buf), i + len(snd))
    if i < len(buf):
        buf[i:j] += snd[: j - i]


def click(dur=0.012, lo=1500, hi=9000, tau=0.003):
    return band(noise(dur), lo, hi) * exp_env(dur, tau)


def partials(d, freqs, amps, taus):
    out = np.zeros(n_of(d))
    for f, a, tau in zip(freqs, amps, taus):
        out += a * np.sin(2 * np.pi * f * tvec(d) + rng.uniform(0, 6.28)) * exp_env(d, tau)
    return out


def reverb(x, size=0.6, mix=0.25):
    ir = noise(size) * exp_env(size, size / 5)
    ir = band(ir, 200, 6000)
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    n = len(x) + len(ir)
    wet = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[: len(x)]
    return x * (1 - mix) + wet * mix * 2


def finalize(x, peak_db=-1.0):
    x = x - np.mean(x)
    f = min(len(x) // 4, int(0.004 * SR))
    x[:f] *= np.linspace(0, 1, f)
    fo = min(len(x) // 4, int(0.03 * SR))
    x[-fo:] *= np.linspace(1, 0, fo)
    pk = np.max(np.abs(x)) or 1
    return x / pk * 10 ** (peak_db / 20)


def save(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ---------- 유압 프레스 ----------
def press_activation():
    d = 2.0
    t = tvec(d)
    f0 = 45 + 25 * (t / d) ** 1.5
    motor = osc(f0, d, "saw") * 0.6 + osc(f0 * 2, d, "sine") * 0.3
    motor = band(motor, 30, 600)
    whine = osc(f0 * 9, d) * 0.05
    hiss = band(noise(d), 1500, 6000) * 0.12 * (t / d) ** 2
    return (motor + whine + hiss) * ar_env(d, 1.2, 0.15)


def press_main():
    d = 1.8
    t = tvec(d)
    rumble = band(noise(d), 20, 180) * 1.2
    sub = osc(38 + 6 * np.sin(2 * np.pi * 0.7 * t), d) * 0.8
    groan = svf_bp(noise(d), 180 + 120 * t / d, q=8) * 0.6
    return (rumble + sub + groan) * ar_env(d, 0.35, 0.4)


def press_detail():
    d = 1.3
    out = np.zeros(n_of(d))
    times = np.sort(rng.uniform(0.0, 1.0, 22))
    for k, at in enumerate(times):
        dur = rng.uniform(0.02, 0.07)
        b = band(noise(dur), 800, 5000) * exp_env(dur, dur / 3) * rng.uniform(0.4, 1.0)
        place(out, b, at)
    ring = partials(d, [410, 980, 1720, 2650], [0.25, 0.18, 0.12, 0.08], [0.25, 0.18, 0.12, 0.08])
    creak = svf_bp(noise(d), 600 + 300 * np.sin(2 * np.pi * 1.3 * tvec(d)), q=20) * 0.35
    return out + ring * 0.6 + creak * ar_env(d, 0.2, 0.5)


def press_finish():
    d = 1.6
    t = tvec(d)
    hiss = band(noise(d), 2500, 12000) * exp_env(d, 0.35) * 0.7
    f0 = 70 * np.exp(-t / 0.6) + 20
    wind = band(osc(f0, d, "saw"), 20, 400) * exp_env(d, 0.5) * 0.7
    clunk = band(noise(0.08), 60, 800) * exp_env(0.08, 0.02)
    out = hiss + wind
    place(out, clunk * 1.2, 0.0)
    return reverb(out, 0.4, 0.2)


# ---------- 망치 ----------
def whoosh(d, f_lo, f_hi, q=1.5, peak=0.55):
    t = tvec(d)
    fc = f_lo + (f_hi - f_lo) * np.sin(np.pi * t / d)
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2
    env = env * np.exp(-((t / d - peak) ** 2) / 0.05)
    return svf_bp(noise(d), fc, q) * env


def hammer_activation():
    return whoosh(0.35, 400, 1800, q=1.2, peak=0.6)


def hammer_main():
    d = 0.7
    t = tvec(d)
    trans = band(noise(0.015), 1000, 12000) * exp_env(0.015, 0.003)
    thump = np.sin(2 * np.pi * (110 + 80 * np.exp(-t / 0.02)) * t) * exp_env(d, 0.07)
    body = partials(d, [340, 760, 1430], [0.4, 0.25, 0.15], [0.06, 0.04, 0.03])
    out = thump + body
    place(out, trans * 1.5, 0)
    return reverb(out, 0.35, 0.15)


def hammer_detail():
    d = 0.9
    out = np.zeros(n_of(d))
    crack = band(noise(0.12), 1200, 8000) * exp_env(0.12, 0.03)
    place(out, crack, 0.0)
    for at in np.sort(rng.uniform(0.02, 0.6, 14)):
        place(out, click(rng.uniform(0.006, 0.02), 2500, 10000) * rng.uniform(0.2, 0.8), at)
    return out


def debris(d, count, lo, hi, spread, low_tail=0.0):
    out = np.zeros(n_of(d))
    times = np.sort(rng.exponential(spread, count))
    times = times[times < d - 0.05]
    for at in times:
        a = math.exp(-at / (d * 0.6)) * rng.uniform(0.3, 1.0)
        place(out, click(rng.uniform(0.008, 0.03), lo, hi, rng.uniform(0.003, 0.008)) * a, at)
    if low_tail:
        out += band(noise(d), 40, 300) * exp_env(d, d / 4) * low_tail
    return out


def hammer_finish():
    return reverb(debris(1.6, 40, 1500, 9000, 0.35, low_tail=0.15), 0.6, 0.25)


# ---------- 알루미늄 배트 ----------
def bat_activation():
    return whoosh(0.5, 250, 1400, q=2.0, peak=0.55) * 1.0 + whoosh(0.5, 900, 3000, q=3, peak=0.6) * 0.3


BAT_F = [612, 1534, 2871, 4210, 5930]


def bat_main():
    d = 1.3
    t = tvec(d)
    ping = partials(d, BAT_F, [0.6, 0.45, 0.3, 0.2, 0.1], [0.45, 0.3, 0.2, 0.12, 0.08])
    thud = np.sin(2 * np.pi * (140 + 60 * np.exp(-t / 0.015)) * t) * exp_env(d, 0.05)
    trans = band(noise(0.01), 2000, 14000) * exp_env(0.01, 0.002)
    out = ping + thud * 0.8
    place(out, trans * 1.3, 0)
    return reverb(out, 0.5, 0.15)


def bat_detail():
    d = 1.2
    t = tvec(d)
    trem = 0.5 + 0.5 * np.sin(2 * np.pi * 23 * t)
    vib = partials(d, [f * 1.003 for f in BAT_F[:3]], [0.4, 0.3, 0.2], [0.5, 0.4, 0.3]) * trem
    rattle = debris(d, 18, 2500, 9000, 0.25)
    return vib + rattle * 0.7


def bat_finish():
    d = 2.6
    a = partials(d, BAT_F[:3], [0.5, 0.3, 0.15], [0.9, 0.6, 0.4])
    b = partials(d, [f + 2.5 for f in BAT_F[:3]], [0.5, 0.3, 0.15], [0.9, 0.6, 0.4])
    return reverb((a + b) * ar_env(d, 0.08, 0.3), 0.8, 0.3)


# ---------- 레이저 ----------
def laser_activation():
    d = 1.2
    t = tvec(d)
    f = 200 * (9 ** (t / d)) * (1 + 0.02 * np.sin(2 * np.pi * 12 * t))
    tone = osc(f, d) * 0.7 + osc(f * 1.5, d) * 0.2
    buzz = band(osc(f / 2, d, "square"), 100, 3000) * 0.15
    return (tone + buzz) * ar_env(d, 1.0, 0.05) ** 1.2


def laser_main():
    d = 1.6
    t = tvec(d)
    base = osc(220, d, "saw") + osc(221.7, d, "saw") + osc(110.4, d, "saw") * 0.6
    base = band(base, 80, 4000) * 0.35
    whine = osc(2200 + 60 * np.sin(2 * np.pi * 6 * t), d) * 0.18
    pulse = 0.8 + 0.2 * np.sin(2 * np.pi * 18 * t)
    zap = band(noise(0.06), 2000, 10000) * exp_env(0.06, 0.015)
    out = (base + whine) * pulse * ar_env(d, 0.03, 0.12)
    place(out, zap * 0.8, 0)
    return out


def laser_detail():
    d = 1.3
    t = tvec(d)
    sizzle = band(noise(d), 3000, 14000) * (0.4 + 0.6 * (rng.random(n_of(d)) > 0.995).astype(float) * 0 + 0.3)
    sizzle *= 0.6 + 0.4 * np.abs(band(noise(d), 5, 40)) / 1.0
    out = sizzle * ar_env(d, 0.05, 0.3) * 0.5
    for at in np.sort(rng.uniform(0.0, d - 0.1, 30)):
        place(out, click(rng.uniform(0.003, 0.01), 3000, 12000, 0.002) * rng.uniform(0.4, 1.0), at)
    return out


def laser_finish():
    d = 0.9
    t = tvec(d)
    f = 1500 * (80 / 1500) ** (t / d)
    return (osc(f, d) * 0.7 + osc(f * 0.5, d, "saw") * 0.15) * exp_env(d, 0.35)


# ---------- 폭탄 ----------
def bomb_activation():
    d = 2.0
    t = tvec(d)
    fizz = band(noise(d), 2500, 9000) * (0.5 + 0.5 * np.abs(band(noise(d), 3, 25)) * 3)
    out = fizz * 0.25 * ar_env(d, 0.1, 0.05)
    for at in rng.uniform(0, d - 0.05, 45):
        place(out, click(rng.uniform(0.002, 0.008), 3000, 12000, 0.0015) * rng.uniform(0.3, 1.0), at)
    tension = osc(60 + 40 * t / d, d) * 0.15 * (t / d) ** 2
    return out + tension


def bomb_main():
    d = 2.6
    t = tvec(d)
    blast = band(noise(d), 30, 3000) * exp_env(d, 0.25)
    crack = band(noise(0.05), 500, 10000) * exp_env(0.05, 0.01)
    sub = np.sin(2 * np.pi * (30 + 40 * np.exp(-t / 0.15)) * t) * exp_env(d, 0.5)
    out = blast * 1.0 + sub * 1.3
    place(out, crack * 1.5, 0)
    out = np.tanh(out * 1.8)
    return reverb(out, 1.2, 0.3)


def bomb_detail():
    d = 1.6
    t = tvec(d)
    rush = svf_bp(noise(d), 300 + 1500 * np.exp(-t / 0.4), q=0.8) * exp_env(d, 0.45)
    return rush * 0.8 + debris(d, 35, 800, 7000, 0.4) * 0.7


def bomb_finish():
    d = 3.2
    rumble = band(noise(d), 25, 160) * exp_env(d, 0.9) * 1.0
    trickle = debris(d, 50, 1200, 8000, 0.9) * 0.5
    return reverb(rumble + trickle, 1.0, 0.3)


# ---------- 카탈로그 사양 ----------
SPECS = [
    ("hydraulic_press", "activation", press_activation, "other", [], "medium", ["low", "metallic"], ["unknown"],
     "모터·유압이 작동하며 저음 모터음이 점점 커지고 높아지는 소리 + 상승하는 유압 쉭 소리."),
    ("hydraulic_press", "main_action", press_main, "press", [], "strong", ["low", "dull"], ["unknown"],
     "프레스가 내려오며 누르는 깊은 저음 럼블과 신음 같은 압축음."),
    ("hydraulic_press", "impact_detail", press_detail, "crack", ["rattle"], "medium", ["metallic", "crunchy"], ["unknown"],
     "눌리며 생기는 불규칙한 찌그러짐·균열 조각음, 짧은 금속 울림, 삐걱임."),
    ("hydraulic_press", "finish", press_finish, "decay", [], "medium", ["airy", "low"], ["unknown"],
     "기계가 멈추는 쿵 + 압력 해제 쉭 + 모터가 느려지며 꺼지는 소리, 짧은 잔향."),
    ("hammer", "activation", hammer_activation, "swing", [], "light", ["airy"], ["unknown"],
     "망치를 휘두르는 짧은 공기음(휙)."),
    ("hammer", "main_action", hammer_main, "impact", [], "strong", ["sharp", "dull"], ["unknown"],
     "날카로운 어택 뒤 짧은 저음 쿵과 몸체 울림이 있는 강한 타격음."),
    ("hammer", "impact_detail", hammer_detail, "crack", ["debris"], "medium", ["crunchy", "sharp"], ["unknown"],
     "타격 직후의 균열음과 작은 조각이 튀는 틱틱 소리."),
    ("hammer", "finish", hammer_finish, "debris", ["decay"], "light", ["rattly", "crunchy"], ["unknown"],
     "파편이 흩어져 떨어지며 점점 잦아드는 소리와 잔향."),
    ("aluminum_bat", "activation", bat_activation, "swing", [], "medium", ["airy"], ["unknown"],
     "배트를 크게 휘둘러 공기를 가르는 휙 소리."),
    ("aluminum_bat", "main_action", bat_main, "impact", [], "strong", ["metallic", "resonant", "sharp"], ["aluminum"],
     "속 빈 금속 배트의 깡 하는 타격음과 둔탁한 충격."),
    ("aluminum_bat", "impact_detail", bat_detail, "rattle", [], "medium", ["metallic", "rattly"], ["aluminum"],
     "타격 후 금속이 떨리는 트레몰로 울림과 작은 파편 소리."),
    ("aluminum_bat", "finish", bat_finish, "decay", [], "light", ["metallic", "resonant"], ["aluminum"],
     "금속 떨림이 맥놀이를 내며 천천히 감쇠하는 잔향."),
    ("laser", "activation", laser_activation, "charge", [], "medium", ["electronic", "bright"], ["unknown"],
     "음높이가 빠르게 올라가는 충전·조준음."),
    ("laser", "main_action", laser_main, "beam", ["fire"], "strong", ["electronic", "bright"], ["unknown"],
     "발사 순간의 지직 소리 후 이어지는 굵은 지속 빔 웅웅 소리와 고음 윙."),
    ("laser", "impact_detail", laser_detail, "other", [], "medium", ["crunchy", "bright"], ["unknown"],
     "표면을 지지는 치이익 소리와 작은 튀는 소리(지짐·절단)."),
    ("laser", "finish", laser_finish, "decay", [], "light", ["electronic"], ["unknown"],
     "빔이 꺼지며 음높이가 떨어지는 전원 감쇠음."),
    ("bomb", "activation", bomb_activation, "other", [], "light", ["crunchy", "airy"], ["unknown"],
     "퓨즈가 타들어가는 치지직 소리와 불꽃 튀는 소리, 아래로 깔리는 긴장음."),
    ("bomb", "main_action", bomb_main, "explosion", [], "strong", ["low", "crunchy"], ["unknown"],
     "날카로운 폭발 어택과 묵직한 저음 충격파, 긴 잔향."),
    ("bomb", "impact_detail", bomb_detail, "debris", [], "medium", ["airy", "rattly"], ["unknown"],
     "폭발 직후 공기가 휩쓸리는 소리와 흩어지는 잔해."),
    ("bomb", "finish", bomb_finish, "decay", ["debris"], "light", ["low", "rattly"], ["unknown"],
     "멀어지는 저음 럼블과 잔해가 간간이 떨어지는 소리."),
]


def main():
    today = date.today().isoformat()
    cat_path = os.path.join(ROOT, "sounds", "catalog.json")
    with open(cat_path, encoding="utf-8") as f:
        cat = json.load(f)
    by_id = {s["sound_id"]: s for s in cat["sounds"]}

    for tool, role, fn, action, sec, inten, tex, mats, desc in SPECS:
        sid = f"{tool}_{role}_001"
        rel = f"assets/audio/tools/{tool}/{role}_001.wav"
        x = finalize(fn())
        save(os.path.join(ROOT, rel), x)
        entry = {
            "sound_id": sid,
            "file_path": rel,
            "original_filename": None,
            "source_type": "generated_in_project",
            "tool_code": tool,
            "sound_role": role,
            "target_objects": [],
            "material_codes": mats,
            "action": action,
            "secondary_actions": sec,
            "intensity": inten,
            "texture_tags": tex,
            "description": desc,
            "duration_seconds": round(len(x) / SR, 3),
            "sample_rate_hz": SR,
            "channels": 1,
            "created_at": by_id.get(sid, {}).get("created_at", today),
            "notes": "scripts/synth_sfx.py로 오프라인 합성(numpy). 참고 페이지 오디오·코드 미사용. 태그는 합성 구성 기준이며 사람 청취 검수는 아직 안 함.",
        }
        by_id[sid] = entry
        print("wrote", rel, entry["duration_seconds"], "s")

    order = [s["sound_id"] for s in cat["sounds"]]
    for sid in by_id:
        if sid not in order:
            order.append(sid)
    cat["sounds"] = [by_id[s] for s in order]
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(cat, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
