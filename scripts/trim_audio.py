"""카탈로그 음원의 앞·뒤 무음과 반복 구간을 잘라 저장한다 (사용자 지시 2026-11-07).

반복 재생은 파일에 넣지 않고 앱 조작(탭할 때마다, 누르고 있는 동안)에 맞춰 엔진이 한다.

- 대상: sounds/catalog.json 의 sounds + material_sounds (제외 목록·source 폴더는 건드리지 않음)
- 원본 보존: 자르기 전 파일은 같은 폴더의 source/ 로 옮긴다(덮어쓰기·삭제 없음).
  단, scripts/synth_sfx.py 로 다시 만들 수 있는 합성음(assets/audio/tools/)은 그 자리에서 자른다.
- 출력: 16-bit PCM WAV, 원본 샘플레이트·채널 유지. MP3는 WAV로 바꿔 저장한다(MP3 인코더 없음).
- 이미 자른 항목(edits에 TRIM_TAG)은 건너뛴다.

실행: python scripts/trim_audio.py [--pylib <miniaudio가 있는 경로>]   (MP3·float WAV 디코딩에 miniaudio 필요)
"""
import hashlib
import json
import os
import shutil
import struct
import sys
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRIM_TAG = "앞뒤 무음·반복 잘라냄(trim_audio.py)"

# 무음 기준: 5 ms 창 피크가 파일 최대 피크 대비 이 값(dB)보다 작으면 무음
SILENCE_DB = -45
PRE_ROLL_MS = 10    # 소리 시작 앞에 남길 여유
POST_ROLL_MS = 10   # 소리 끝 뒤에 남길 여유
FADE_IN_MS = 2
FADE_OUT_MS = 15

# 같은 소리가 한 파일에 반복되는 경우: 첫 번째만 남긴다.
# (검색 구간 시작 s, 끝 s): 이 구간에서 10 ms RMS가 가장 작은 지점에서 자른다.
REPEAT_CUTS = {
    "aluminum_can_tap_x5_001": {"search": (0.20, 0.31), "new_id": "aluminum_can_tap_single_001",
                                "new_label": "aluminum_can_tap_single", "note": "맥주 캔 두드림 5회 중 첫 번째만 남김"},
    "aluminum_can_crush_001": {"search": (1.20, 1.65), "note": "찌그러짐 뒤 약 0.9초 후 따로 난 작은 소리 제거"},
    "glass_scrape_001": {"search": (0.75, 0.95), "note": "긁기 3회 중 첫 번째만 남김"},
}


# ---------------- 디코딩 / 저장 ----------------

def _read_wav_riff(data):
    """wave 모듈이 못 읽는 float WAV(형식 3)까지 직접 파싱. (samples[n, ch] float64, sr)"""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a WAV")
    pos, fmt, raw = 12, None, None
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            tag, ch, sr, _, _, bits = struct.unpack("<HHIIHH", body[:16])
            if tag == 0xFFFE and len(body) >= 26:
                tag = struct.unpack("<H", body[24:26])[0]
            fmt = (tag, ch, sr, bits)
        elif cid == b"data":
            raw = body
        pos += 8 + size + (size & 1)
    tag, ch, sr, bits = fmt
    if tag == 3 and bits == 32:
        x = np.frombuffer(raw[: len(raw) // 4 * 4], "<f4").astype(np.float64)
    elif tag == 3 and bits == 64:
        x = np.frombuffer(raw[: len(raw) // 8 * 8], "<f8").astype(np.float64)
    elif tag == 1 and bits == 16:
        x = np.frombuffer(raw[: len(raw) // 2 * 2], "<i2") / 32768.0
    elif tag == 1 and bits == 24:
        b = np.frombuffer(raw[: len(raw) // 3 * 3], np.uint8).reshape(-1, 3)
        v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        v = np.where(v & 0x800000, v - 0x1000000, v)
        x = v / 8388608.0
    elif tag == 1 and bits == 32:
        x = np.frombuffer(raw[: len(raw) // 4 * 4], "<i4") / 2147483648.0
    else:
        raise ValueError(f"unsupported WAV format tag={tag} bits={bits}")
    return x[: len(x) // ch * ch].reshape(-1, ch), sr


def decode(path):
    data = open(path, "rb").read()
    if path.lower().endswith(".wav"):
        return _read_wav_riff(data)
    import miniaudio  # MP3 등
    info = miniaudio.mp3_get_info(data) if path.lower().endswith(".mp3") else None
    ch, sr = (info.nchannels, info.sample_rate) if info else (2, 44100)
    d = miniaudio.decode(data, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=ch, sample_rate=sr)
    return np.frombuffer(d.samples, np.float32).astype(np.float64).reshape(-1, ch), sr


def save_wav(path, x, sr):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if x.ndim == 1:
        x = x[:, None]
    pcm = (np.clip(x, -1, 1) * 32767).round().astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


# ---------------- 자르기 ----------------

def _mono(x):
    return x if x.ndim == 1 else x.mean(1)


def cut_at_quietest(x, sr, search):
    """search 구간에서 10 ms RMS가 가장 작은 지점까지만 남긴다 (반복 사건 앞에서 자름)."""
    m = _mono(x)
    w = int(sr * 0.01)
    a, b = int(search[0] * sr), min(len(m), int(search[1] * sr))
    starts = range(a, max(a + 1, b - w), max(1, w // 4))
    best = min(starts, key=lambda i: float(np.mean(m[i:i + w] ** 2)))
    return x[: best + w // 2]


def trim_silence(x, sr, silence_db=SILENCE_DB):
    """앞·뒤 무음 제거 + 짧은 페이드(클릭 방지). (잘라낸 x, 앞에서 뺀 ms, 뒤에서 뺀 ms)"""
    m = np.abs(_mono(x))
    w = max(1, int(sr * 0.005))
    n = len(m) // w
    if n == 0:
        return x, 0, 0
    pk = m[: n * w].reshape(n, w).max(1)
    thr = pk.max() * 10 ** (silence_db / 20)
    on = np.where(pk > thr)[0]
    if not len(on):
        return x, 0, 0
    s = max(0, on[0] * w - int(sr * PRE_ROLL_MS / 1000))
    e = min(len(m), (on[-1] + 1) * w + int(sr * POST_ROLL_MS / 1000))
    y = x[s:e].copy()
    fi = min(len(y) // 4, int(sr * FADE_IN_MS / 1000)) if s > 0 else 0
    fo = min(len(y) // 4, int(sr * FADE_OUT_MS / 1000)) if e < len(m) else 0
    if fi:
        y[:fi] *= np.linspace(0, 1, fi)[:, None] if y.ndim > 1 else np.linspace(0, 1, fi)
    if fo:
        y[-fo:] *= np.linspace(1, 0, fo)[:, None] if y.ndim > 1 else np.linspace(1, 0, fo)
    return y, round(s / sr * 1000), round((len(m) - e) / sr * 1000)


def levels(x, sr):
    """카탈로그용 level_db(1024샘플 창 RMS 최댓값)·peak_db (44.1 kHz 기준 창 길이와 같게 맞춤)"""
    m = _mono(x)
    w = max(1, int(round(1024 * sr / 44100)))
    n = len(m) // w
    r = np.sqrt((m[: n * w].reshape(n, w) ** 2).mean(1) + 1e-15) if n else np.array([1e-9])
    return round(float(20 * np.log10(r.max())), 1), round(float(20 * np.log10(np.abs(m).max() + 1e-12)), 1)


# ---------------- 카탈로그 처리 ----------------

def backup_path(src_abs):
    d, base = os.path.split(src_abs)
    dst = os.path.join(d, "source", base)
    if os.path.exists(dst):
        same = hashlib.sha1(open(dst, "rb").read()).digest() == hashlib.sha1(open(src_abs, "rb").read()).digest()
        if same:
            return dst, True
        stem, ext = os.path.splitext(base)
        dst = os.path.join(d, "source", f"{stem}.pretrim{ext}")
    return dst, False


def main():
    if "--pylib" in sys.argv:
        sys.path.insert(0, sys.argv[sys.argv.index("--pylib") + 1])
    cat_path = os.path.join(ROOT, "sounds", "catalog.json")
    cat = json.load(open(cat_path, encoding="utf-8"))
    entries = [("sounds", s) for s in cat["sounds"]] + [("material_sounds", m) for m in cat.get("material_sounds", [])]
    done = {}  # 기존 file_path -> 새 file_path (같은 파일을 두 목록이 가리킬 때)
    report = []
    for kind, e in entries:
        old_rel = e["file_path"]
        if TRIM_TAG in (e.get("edits") or []):
            continue
        if old_rel in done:
            new_rel, meta = done[old_rel]
        else:
            old_abs = os.path.join(ROOT, old_rel)
            x, sr = decode(old_abs)
            dur0 = len(x) / sr
            notes = []
            rc = REPEAT_CUTS.get(e["sound_id"])
            if rc:
                x = cut_at_quietest(x, sr, rc["search"])
                notes.append(rc["note"])
            x, cut_head, cut_tail = trim_silence(x, sr)
            if cut_head or cut_tail:
                notes.append(f"앞 무음 {cut_head} ms·뒤 무음 {cut_tail} ms 제거")
            new_id = (rc or {}).get("new_id", e["sound_id"])
            d = os.path.dirname(old_rel)
            base = os.path.basename(old_rel)
            stem = os.path.splitext(base)[0] if kind == "sounds" else new_id
            if rc and rc.get("new_id"):
                stem = new_id
            new_rel = f"{d}/{stem}.wav"
            regenerable = old_rel.startswith("assets/audio/tools/")
            backup_rel = None
            if not regenerable:
                dst, existed = backup_path(old_abs)
                if not existed:
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.move(old_abs, dst)
                else:
                    os.remove(old_abs) if new_rel != old_rel else None  # source/에 같은 내용이 이미 있으면 사본만 정리
                backup_rel = os.path.relpath(dst, ROOT).replace("\\", "/")
            if os.path.exists(os.path.join(ROOT, new_rel)) and new_rel != old_rel:
                sys.exit(f"exists, not overwriting: {new_rel}")
            save_wav(os.path.join(ROOT, new_rel), x, sr)
            level_db, peak_db = levels(x, sr)
            meta = {
                "duration_seconds": round(len(x) / sr, 3), "sample_rate_hz": sr, "channels": x.shape[1],
                "level_db": level_db, "peak_db": peak_db, "backup": backup_rel, "notes": notes,
                "new_id": new_id, "new_label": (rc or {}).get("new_label"), "repeat_cut": bool(rc),
            }
            done[old_rel] = (new_rel, meta)
            report.append(f"{e['sound_id']:34s} {dur0:5.2f}s → {meta['duration_seconds']:5.2f}s  {'; '.join(notes) or '변경 없음'}")
        # 항목 갱신
        e["file_path"] = new_rel
        e["duration_seconds"] = meta["duration_seconds"]
        e["sample_rate_hz"] = meta["sample_rate_hz"]
        e["channels"] = meta["channels"]
        if "format" in e:
            e["format"] = "wav"
        if kind == "material_sounds":
            e["level_db"], e["peak_db"], e["onset_ms"] = meta["level_db"], meta["peak_db"], 0
            if meta["repeat_cut"]:
                e["sound_id"] = meta["new_id"]
                if meta["new_label"]:
                    e["label"] = meta["new_label"]
                if e.get("repeat_count", 1) and e.get("repeat_count", 1) > 1:
                    e["repeat_count"] = 1
                    e["description"] = e["description"].replace("약 0.2초 간격으로 5번", "한 번")
        if meta["backup"]:
            e["derived_from"] = e.get("derived_from") or meta["backup"]
            if e.get("derived_from") != meta["backup"]:
                e["pre_trim_file"] = meta["backup"]
        e["edits"] = (e.get("edits") or []) + [TRIM_TAG] + meta["notes"]
    json.dump(cat, open(cat_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(cat_path, "a", encoding="utf-8").write("\n")
    print("\n".join(report))


if __name__ == "__main__":
    main()
