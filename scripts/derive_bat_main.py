"""제공 음원 배트 타격음(851452 bat_hit2)에서 '더 길고 큰' 파생 버전을 만든다.

- 길게: 원본에서 금속 공명 성분(약 2.0~2.5kHz)을 뽑아 공명 필터로 울림을 늘리고, 짧은 잔향을 더한다.
- 크게: 피크 정규화 후 부드러운 포화(tanh)로 체감 음량(RMS)을 올리고 다시 -1dBFS로 맞춘다.
원본 파일은 바꾸지 않는다.

필요: pip install miniaudio  (MP3 디코딩)
실행: python scripts/derive_bat_main.py   (프로젝트 루트에서)
"""
import os
import sys
import wave

import numpy as np

try:
    import miniaudio
except ImportError:
    sys.exit("miniaudio가 필요합니다: pip install miniaudio")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/audio/provided/source/851452__hashtagsmcgee__bat_hit2.mp3")
DST = os.path.join(ROOT, "assets/audio/provided/aluminum_bat_main_action_003.wav")
SR = 48000

# 원본 스펙트럼에서 찾은 공명 주파수(Hz)와 상대 크기, 감쇠 시간(초)
PARTIALS = [(1994, 1.0, 0.55), (2085, 0.4, 0.4), (2117, 0.4, 0.4), (2500, 0.2, 0.3)]
RING_LEVEL = 0.25   # 타격음 피크(1.0) 대비 늘린 울림의 최대 크기
REVERB_LEVEL = 0.12
TAIL_S = 2.0        # 원본 뒤에 붙일 수 있는 최대 꼬리 길이
DRIVE = 4.0         # 포화 강도 (클수록 더 크게 들림)


def fft_conv(a, b):
    n = len(a) + len(b) - 1
    N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(a, N) * np.fft.rfft(b, N), N)[:n]


def band(x, lo, hi):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))


def main():
    # 한글 경로는 miniaudio가 직접 못 여므로 바이트로 읽어 넘긴다
    with open(SRC, "rb") as f:
        d = miniaudio.decode(f.read(), output_format=miniaudio.SampleFormat.FLOAT32, nchannels=2, sample_rate=SR)
    x = np.frombuffer(d.samples, np.float32).reshape(-1, 2).astype(float)
    n_out = len(x) + int(TAIL_S * SR)
    t = np.arange(int(TAIL_S * SR)) / SR

    ir_ring = sum(a * np.exp(-t / tau) * np.sin(2 * np.pi * f * t) for f, a, tau in PARTIALS)
    ir_ring /= np.abs(np.fft.rfft(ir_ring)).max()  # 공명 대역 이득을 1로
    rng = np.random.default_rng(851452)
    ir_rev = rng.standard_normal(int(1.2 * SR)) * np.exp(-np.arange(int(1.2 * SR)) / SR / 0.3)
    ir_rev = band(ir_rev, 200, 8000)
    ir_rev /= np.sqrt(np.sum(ir_rev ** 2))

    # 타격음 자체만 포화시켜 크게 만들고, 늘린 울림·잔향은 그 뒤에 정해진 크기로 더한다
    hit = x / np.abs(x).max()
    hit = np.tanh(hit * DRIVE) / np.tanh(DRIVE)
    out = np.zeros((n_out, 2))
    for c in range(2):
        dry = x[:, c]
        ring = fft_conv(band(dry, 1800, 2700), ir_ring)[:n_out]
        ring *= RING_LEVEL / (np.abs(ring).max() + 1e-12)
        rev = fft_conv(dry, ir_rev)[:n_out]
        rev *= REVERB_LEVEL / (np.abs(rev).max() + 1e-12)
        out[: len(dry), c] += hit[:, c]
        out[: len(ring), c] += ring
        out[: len(rev), c] += rev

    # -60dB 아래로 내려간 꼬리는 잘라내고 끝을 부드럽게
    env = np.abs(out).max(1)
    last = len(env) - 1 - np.argmax(env[::-1] > 10 ** (-60 / 20))
    out = out[: last + 1]
    fo = int(0.05 * SR)
    out[-fo:] *= np.linspace(1, 0, fo)[:, None]
    out *= 10 ** (-1 / 20) / np.abs(out).max()

    with wave.open(DST, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(out, -1, 1) * 32767).astype("<i2").tobytes())

    def rms_db(a):
        return 20 * np.log10(np.sqrt(np.mean(a.mean(1) ** 2)) + 1e-12)

    def win_rms(a, s, e):
        return rms_db(a[int(s * SR): int(e * SR)])

    print(f"wrote {os.path.relpath(DST, ROOT)}")
    print(f"length {len(x) / SR:.3f}s -> {len(out) / SR:.3f}s")
    print(f"hit RMS (0~0.1s) {win_rms(x, 0, 0.1):.1f} -> {win_rms(out, 0, 0.1):.1f} dB")
    print(f"tail RMS (0.2~0.6s) {win_rms(x, 0.2, 0.6):.1f} -> {win_rms(out, 0.2, 0.6):.1f} dB")
    print(f"tail RMS (0.6~1.2s) {'-' if len(x) < 0.7 * SR else win_rms(x, 0.6, 1.2)} -> {win_rms(out, 0.6, 1.2):.1f} dB")


if __name__ == "__main__":
    main()
