"""저장된 음원의 실제 음량을 재서 catalog.json에 적고, 그 측정값으로 재생 기준 gain(mix.base_gain_db)을 계산한다.
음원 파일은 읽기만 한다 (증폭·덮어쓰기 없음).

측정값 (source_loudness, 파일 원본 그대로의 값):
  integrated_lufs   ITU-R BS.1770-4 integrated loudness (K-weighting, 400 ms 블록 75% 겹침, -70 LUFS 절대·-10 LU 상대 게이트).
                    0.4초보다 짧은 파일은 블록을 하나도 만들 수 없어 null (측정 불가, 임의 값 넣지 않음)
  max_loudness_100ms_lufs  K-weighting·BS.1770 채널 가중 후 가장 큰 100 ms 창의 음량 (짧은 타격음도 잴 수 있는 값)
  playback_max_loudness_100ms_lufs  같은 값을 브라우저가 실제로 내는 스테레오 신호로 잰 것 (모노는 양쪽 채널로,
                    5.1은 Web Audio 다운믹스). 재생 기준 gain 계산에 쓴다 — 모노·스테레오·5.1 파일을 같은 잣대로 비교
  true_peak_dbtp    4배 오버샘플링(FFT 보간) 후 최대 절댓값. BS.1770 부록 2의 FIR 보간과 방식이 달라 근사값
  peak_dbfs         샘플 최대 절댓값
  rms_dbfs          파일 전체 RMS (채널 평균 전력)
  level_db·peak_db  기존 엔진 호환용 (1024샘플 창 RMS 최댓값 / 샘플 피크)

재생 설정 (mix, 측정값에서 계산한 앱 재생 값. 규칙은 sounds/mix_settings.json):
  base_gain_db      물건 음원: 파일마다 max_loudness_100ms_lufs → object_target_lufs
                    도구 음원: 도구 핵심(main_action, 꺼져 있으면 가장 큰 역할) 음원 기준으로 도구 전체에 같은 값
                              → 한 도구 안에서 휘두름·타격·마무리의 원래 비율을 유지
  priority, ducking_group  엔진이 겹침 처리에 쓰는 분류 (src/audio/soundComposer.js)

실행: python scripts/measure_levels.py --pylib <miniaudio 경로>
도구 음원을 다시 만들거나 음원을 바꾸면 다시 실행한다.
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if "--pylib" in sys.argv:
    sys.path.insert(0, sys.argv[sys.argv.index("--pylib") + 1])
from trim_audio import decode, levels  # noqa: E402

CATALOG = os.path.join(ROOT, "sounds", "catalog.json")
SETTINGS = os.path.join(ROOT, "sounds", "mix_settings.json")
TOOL_ROLES_DISABLED_JS = os.path.join(ROOT, "src", "audio", "presets", "toolPresets.js")


# ---------------- 측정 ----------------

def biquad(x, b, a):
    """Direct Form I 2차 필터 (scipy 없이). x: (n, ch)"""
    b0, b1, b2 = b / a[0]
    a1, a2 = a[1] / a[0], a[2] / a[0]
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = np.zeros(x.shape[1])
    for i in range(len(x)):
        v = x[i]
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def k_weight(x, sr):
    """BS.1770 K-weighting: 고역 셸프(+4 dB, 1.5 kHz, Q 0.707) → 하이패스(38 Hz, Q 0.5). 임의 샘플레이트용 RBJ 공식
    (48 kHz에서 BS.1770 표준 계수와 거의 같다)"""
    A = 10 ** (4 / 40)
    w0 = 2 * np.pi * 1500 / sr
    c, al = np.cos(w0), np.sin(w0) / (2 * (1 / np.sqrt(2)))
    b = np.array([A * ((A + 1) + (A - 1) * c + 2 * np.sqrt(A) * al), -2 * A * ((A - 1) + (A + 1) * c),
                  A * ((A + 1) + (A - 1) * c - 2 * np.sqrt(A) * al)])
    a = np.array([(A + 1) - (A - 1) * c + 2 * np.sqrt(A) * al, 2 * ((A - 1) - (A + 1) * c),
                  (A + 1) - (A - 1) * c - 2 * np.sqrt(A) * al])
    y = biquad(x, b, a)
    w0 = 2 * np.pi * 38 / sr
    c, al = np.cos(w0), np.sin(w0) / (2 * 0.5)
    b = np.array([(1 + c) / 2, -(1 + c), (1 + c) / 2])
    a = np.array([1 + al, -2 * c, 1 - al])
    return biquad(y, b, a)


def lufs_of(power):
    return -0.691 + 10 * np.log10(power + 1e-20)


# BS.1770 채널 가중치 (5.1: L R C LFE Ls Rs)
BS1770_WEIGHTS = {1: [1.0], 2: [1.0, 1.0], 6: [1.0, 1.0, 1.0, 0.0, 1.41, 1.41]}


def webaudio_stereo(x):
    """Web Audio가 스테레오 출력으로 내보내는 신호 (channelInterpretation 'speakers' 다운믹스 규칙)"""
    ch = x.shape[1]
    if ch == 1:
        return np.repeat(x, 2, axis=1)
    if ch == 2:
        return x
    if ch == 6:
        L, R, C, _lfe, SL, SR = (x[:, i] for i in range(6))
        return np.stack([L + 0.7071 * (C + SL), R + 0.7071 * (C + SR)], 1)
    return None


def max_100ms(p, sr):
    w = max(1, int(sr * 0.1))
    if len(p) < w:
        return float(lufs_of(p.mean())), True
    c = np.concatenate([[0], np.cumsum(p)])
    return float(lufs_of(((c[w:] - c[:-w]) / w).max())), False


def measure(x, sr):
    if x.ndim == 1:
        x = x[:, None]
    x = x.astype(np.float64)
    weights = np.array(BS1770_WEIGHTS.get(x.shape[1], [1.0] * x.shape[1]))
    out = {"unmeasured": []}
    out["peak_dbfs"] = round(float(20 * np.log10(np.abs(x).max() + 1e-12)), 1)
    out["rms_dbfs"] = round(float(10 * np.log10((x ** 2).mean() + 1e-20)), 1)
    # true peak: 4배 FFT 보간
    n = len(x)
    up = np.fft.irfft(np.fft.rfft(x, axis=0), n * 4, axis=0) * 4
    out["true_peak_dbtp"] = round(float(20 * np.log10(np.abs(up).max() + 1e-12)), 1)

    y = k_weight(x, sr)
    p = (y ** 2 * weights).sum(1)  # BS.1770 채널 가중 합 (모노는 1채널 그대로)
    v, short = max_100ms(p, sr)
    out["max_loudness_100ms_lufs"] = round(v, 1)
    if short:
        out["unmeasured"].append("max_loudness_100ms_lufs: 0.1초보다 짧아 파일 전체 평균")
    # 재생 기준: 브라우저가 실제로 내보내는 스테레오 신호의 최대 100 ms 음량 (모노는 양쪽으로, 5.1은 다운믹스)
    st = webaudio_stereo(x)
    if st is None:
        out["playback_max_loudness_100ms_lufs"] = None
        out["unmeasured"].append(f"playback_max_loudness_100ms_lufs: {x.shape[1]}채널 다운믹스 규칙 없음")
    else:
        out["playback_max_loudness_100ms_lufs"] = round(max_100ms((k_weight(st, sr) ** 2).sum(1), sr)[0], 1)
    # integrated (BS.1770-4 게이팅)
    blk, hop = int(sr * 0.4), int(sr * 0.1)
    if len(p) < blk:
        out["integrated_lufs"] = None
        out["unmeasured"].append("integrated_lufs: 0.4초보다 짧아 400 ms 게이팅 블록 없음")
    else:
        starts = range(0, len(p) - blk + 1, hop)
        z = np.array([p[s:s + blk].mean() for s in starts])
        z = z[lufs_of(z) > -70]
        if not len(z):
            out["integrated_lufs"] = None
            out["unmeasured"].append("integrated_lufs: 모든 블록이 -70 LUFS 이하")
        else:
            rel = lufs_of(z.mean()) - 10
            z2 = z[lufs_of(z) > rel]
            out["integrated_lufs"] = round(float(lufs_of(z2.mean())), 1)
    # 스펙트럼: 에너지가 가장 많은 옥타브 대역 중심 (겹침 때 짧은 대역 ducking 주파수로 쓴다)
    mono = x.mean(1)
    S = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    f = np.fft.rfftfreq(len(mono), 1 / sr)
    centers = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    shares = [S[(f >= c / 2 ** 0.5) & (f < c * 2 ** 0.5)].sum() for c in centers]
    tot = S.sum() + 1e-20
    out["spectrum"] = {
        "dominant_octave_hz": centers[int(np.argmax(shares))],
        "centroid_hz": int(round(float((S * f).sum() / tot))),
        "octave_share_pct": {str(c): round(float(v / tot * 100), 1) for c, v in zip(centers, shares)},
    }
    return out


# ---------------- 재생 gain ----------------

def disabled_roles():
    """toolPresets.js의 disabledRoles를 읽는다 (핵심이 꺼진 도구의 기준 음원 선택용)"""
    import re
    src = open(TOOL_ROLES_DISABLED_JS, encoding="utf-8").read()
    res = {}
    for m in re.finditer(r"\n  (\w+): \{(.*?)\n  \},", src, re.S):
        d = re.search(r"disabledRoles:\s*\[([^\]]*)\]", m.group(2))
        res[m.group(1)] = re.findall(r"'(\w+)'", d.group(1)) if d else []
    return res


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def main():
    with open(CATALOG, encoding="utf-8") as f:
        data = json.load(f)
    with open(SETTINGS, encoding="utf-8") as f:
        cfg = json.load(f)
    ref_key = cfg["reference"]
    cache = {}
    missing = []

    def do(e):
        fp = os.path.join(ROOT, e["file_path"])
        if not os.path.exists(fp):
            e["source_loudness"] = {k: None for k in ("integrated_lufs", "max_loudness_100ms_lufs",
                                                      "playback_max_loudness_100ms_lufs", "true_peak_dbtp",
                                                      "peak_dbfs", "rms_dbfs")}
            e["source_loudness"]["measurement_status"] = "unknown"
            e["source_loudness"]["unmeasured"] = ["파일 없음"]
            missing.append(e["file_path"])
            return
        if fp not in cache:
            try:
                x, sr = decode(fp)
                cache[fp] = (measure(x, sr), levels(x, sr))
            except Exception as err:  # 디코딩 실패: 숫자를 만들지 않는다
                cache[fp] = (None, (None, None))
                missing.append(f"{e['file_path']} ({err})")
        m, (lv, pk) = cache[fp]
        if m is None:
            e["source_loudness"] = {"integrated_lufs": None, "max_loudness_100ms_lufs": None,
                                    "playback_max_loudness_100ms_lufs": None, "true_peak_dbtp": None,
                                    "peak_dbfs": None, "rms_dbfs": None, "measurement_status": "unknown",
                                    "unmeasured": ["디코딩 실패"]}
            return
        sl = {k: m[k] for k in ("integrated_lufs", "max_loudness_100ms_lufs", "playback_max_loudness_100ms_lufs",
                                "true_peak_dbtp", "peak_dbfs", "rms_dbfs")}
        sl["measurement_status"] = "measured" if not m["unmeasured"] else "partial"
        if m["unmeasured"]:
            sl["unmeasured"] = m["unmeasured"]
        sl["method"] = "measure_levels.py: BS.1770-4 K-weighting·게이팅, true peak 4x FFT 보간(근사)"
        e["source_loudness"] = sl
        e["spectrum"] = m["spectrum"]
        e["level_db"], e["peak_db"] = lv, pk

    for e in data.get("sounds", []):
        do(e)
    for e in data.get("material_sounds", []):
        do(e)

    # 물건 음원: 파일마다 기준 음량에 맞춘다
    oc = cfg["object"]
    for e in data.get("material_sounds", []):
        ref = e["source_loudness"].get(ref_key)
        trim = cfg.get("trim_db", {}).get(e["sound_id"], 0)
        if ref is None:
            e["mix"] = {"base_gain_db": None, "priority": "object_identity", "ducking_group": "object_identity",
                        "notes": "측정 불가 → 보정 없이 재생"}
            continue
        g = clamp(oc["target_lufs"] - ref, -oc["max_cut_db"], oc["max_boost_db"]) + trim
        e["mix"] = {
            "base_gain_db": round(g, 1),
            "priority": "object_identity",
            "ducking_group": "object_identity",
            "notes": f"{ref_key} {ref} → 목표 {oc['target_lufs']} LUFS" + (f", 개별 조정 {trim:+} dB" if trim else ""),
        }

    # 도구 음원: 도구 핵심 기준 한 값
    tc = cfg["tool"]
    dis = disabled_roles()
    tools = {}
    for e in data.get("sounds", []):
        if e.get("tool_code") and e.get("sound_role"):
            tools.setdefault(e["tool_code"], []).append(e)
    for tool, ents in tools.items():
        own = [e for e in ents if e["sound_role"] not in dis.get(tool, []) and e["source_loudness"].get(ref_key) is not None]
        main = [e for e in own if e["sound_role"] == "main_action"]
        basis = main or own
        ref_e = max(basis, key=lambda e: e["source_loudness"][ref_key]) if basis else None
        for e in ents:
            trim = cfg.get("trim_db", {}).get(e["sound_id"], 0)
            if ref_e is None:
                e["mix"] = {"base_gain_db": None, "priority": "tool_support", "ducking_group": None,
                            "notes": "측정 불가 → 보정 없이 재생"}
                continue
            ref = ref_e["source_loudness"][ref_key]
            g = clamp(tc["target_lufs"] - ref, -tc["max_cut_db"], tc["max_boost_db"]) + trim
            prio = cfg["tool_priority"].get(f"{tool}.{e['sound_role']}", "tool_support")
            e["mix"] = {
                "base_gain_db": round(g, 1),
                "priority": prio,
                "ducking_group": "tool_action" if prio == "tool_action" else None,
                "notes": f"도구 기준 {ref_e['sound_id']} {ref_key} {ref} → 목표 {tc['target_lufs']} LUFS"
                         + (f", 개별 조정 {trim:+} dB" if trim else ""),
            }

    with open(CATALOG, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"{'sound_id':34s} {'I-LUFS':>7s} {'100ms':>6s} {'play':>6s} {'dBTP':>5s} {'dBFS':>5s} {'RMS':>6s}  base_gain")
    for e in data.get("sounds", []) + data.get("material_sounds", []):
        s = e["source_loudness"]
        f = lambda v: "  null" if v is None else f"{v:6.1f}"
        bg = e.get("mix", {}).get("base_gain_db")
        print(f"{e['sound_id']:34s} {f(s['integrated_lufs']):>7s} {f(s['max_loudness_100ms_lufs'])} {f(s['playback_max_loudness_100ms_lufs'])} {f(s['true_peak_dbtp'])}"
              f" {f(s['peak_dbfs'])} {f(s['rms_dbfs'])}  {'-' if bg is None else f'{bg:+.1f}'}  {s['measurement_status']}")
    if missing:
        print("측정 못 함:", *missing, sep="\n  ")


if __name__ == "__main__":
    main()
