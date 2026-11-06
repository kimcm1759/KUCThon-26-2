"""sound 브랜치 음원 → web 앱 소리 폴더(web/public/sounds/<물건>/<연장>/<이벤트>.wav)로 내보내기.

web 앱 이벤트 타이밍(?sync 패널 실측, 망치):
  0.000s hammer/swing  → 0.149s hammer/hit + hammer/damage(안 깨질 때) 또는 hammer/break(마지막 타격)
  → 그 뒤 debris/small·large (조각이 책상에 닿을 때마다)
망치 애니메이션은 140 ms에 타격(ToolActors.tsx Hammer), 60fps 프레임 때문에 로그엔 ~0.149s.

원본은 읽기만 하고 덮어쓰지 않는다. 결과는 48 kHz 16bit 모노 WAV.
사용: python scripts/export_web_sounds.py --web <web 폴더> [--only can]
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from trim_audio import _read_wav_riff, save_wav  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000

SRC = {
    "hammer_swing": "assets/audio/tools/hammer/activation_001.wav",
    "hammer_hit": "assets/audio/provided/hammer_main_action_002.wav",
    "bat_swing": "assets/audio/tools/aluminum_bat/activation_001.wav",
    "bat_hit": "assets/audio/provided/aluminum_bat_main_action_003.wav",
    "press_motor": "assets/audio/tools/hydraulic_press/activation_001.wav",
    "press_press": "assets/audio/tools/hydraulic_press/main_action_001.wav",
    "press_release": "assets/audio/tools/hydraulic_press/finish_001.wav",
    "laser_start": "assets/audio/tools/laser/activation_001.wav",
    "laser_burn": "assets/audio/tools/laser/impact_detail_001.wav",
    "laser_end": "assets/audio/tools/laser/finish_001.wav",
    "bomb_fuse": "assets/audio/tools/bomb/activation_001.wav",
    "bomb_explode": "assets/audio/tools/bomb/main_action_001.wav",
    "cardboard_rub": "assets/audio/materials/cardboard/cardboard_box_rub_001.wav",
    "cardboard_tap": "assets/audio/materials/cardboard/cardboard_box_tap_single_001.wav",
    "plastic_key": "assets/audio/materials/plastic/plastic_key_press_single_001.wav",
    "glass_tap": "assets/audio/materials/glass/glass_tap_single_001.wav",
    "glass_scrape": "assets/audio/materials/glass/glass_scrape_001.wav",
    "glass_shatter": "assets/audio/materials/glass/glass_shatter_fall_001.wav",
    "paper_tear": "assets/audio/provided/paper_tear_001.wav",
    "paper_crumple": "assets/audio/materials/paper/paper_crumple_001.wav",
    "paper_tap": "assets/audio/materials/paper/paper_sheet_tap_single_001.wav",
    "can_tap": "assets/audio/materials/aluminum/aluminum_can_tap_single_001.wav",
    "can_crush": "assets/audio/materials/aluminum/aluminum_can_crush_001.wav",
}


def lowpass(x, cutoff, sr, taps=101):
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * cutoff / sr * n) * np.hamming(taps)
    return np.convolve(x, h / h.sum(), mode="same")


def resample(x, sr_in, sr_out):
    """선형 보간. 내릴 때는 먼저 저역통과로 접힘(aliasing) 방지."""
    if sr_in == sr_out:
        return x
    if sr_out < sr_in:
        x = lowpass(x, 0.45 * sr_out, sr_in)
    t = np.arange(int(len(x) * sr_out / sr_in)) * (sr_in / sr_out)
    return np.interp(t, np.arange(len(x)), x)


def load(key):
    with open(os.path.join(ROOT, SRC[key]), "rb") as f:
        x, sr = _read_wav_riff(f.read())
    return resample(x.mean(1), sr, SR)  # 모노로 합침 (6채널 키보드 녹음 포함)


def ms(v):
    return int(round(v * SR / 1000))


def cut(x, start_ms=0, end_ms=None):
    return x[ms(start_ms): None if end_ms is None else ms(end_ms)]


def fade(x, in_ms=2, out_ms=10):
    x = x.copy()
    a, b = min(len(x), ms(in_ms)), min(len(x), ms(out_ms))
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def pitch(x, ratio):
    """ratio > 1: 빨라지고 높아짐 (작은 조각)."""
    t = np.arange(0, len(x) - 1, ratio)
    return np.interp(t, np.arange(len(x)), x)


def mix(*layers):
    """(신호, dB, 시작 ms) 들을 겹침."""
    n = max(ms(at) + len(s) for s, _, at in layers)
    out = np.zeros(n)
    for s, db, at in layers:
        out[ms(at): ms(at) + len(s)] += s * 10 ** (db / 20)
    return out


def seamless(x, xf_ms=80):
    """🔁용: 끝 xf_ms를 시작에 겹쳐(등전력 크로스페이드) 이음새 없이 반복되게. 길이는 xf_ms만큼 줄어듦."""
    n = ms(xf_ms)
    a = np.linspace(0, np.pi / 2, n)
    head = x[:n] * np.sin(a) + x[-n:] * np.cos(a)
    return np.concatenate([head, x[n:-n]])


def ring_cut(x, hold_ms, end_ms, end_db):
    """hold_ms까지 그대로, 그 뒤 end_ms에 end_db가 되게 지수 감쇠 (울림 꼬리 줄이기). 끝 20 ms 페이드."""
    g = np.ones(len(x))
    t = np.arange(len(x)) / SR * 1000
    after = t > hold_ms
    g[after] = 10 ** (end_db / 20 * (t[after] - hold_ms) / (end_ms - hold_ms))
    return fade(x * g, 2, 20)


def saturate(x, drive):
    """tanh 포화: 큰 소리는 눌리고 작은 소리는 올라가 더 꽉 차게(크게) 들림."""
    x = x / np.abs(x).max()
    return np.tanh(drive * x) / np.tanh(drive)


def attack_to(x, win_ms, db):
    """앞 win_ms 구간의 피크가 db가 되게 (꼬리를 줄여도 타격 크기는 그대로 유지)."""
    p = np.abs(x[: ms(win_ms)]).max()
    return x * (10 ** (db / 20) / p) if p else x


def peak_to(x, db):
    p = np.abs(x).max()
    return x * (10 ** (db / 20) / p) if p else x


def build_can():
    swing, hit = load("hammer_swing"), load("hammer_hit")
    tap, crush = load("can_tap"), load("can_crush")
    # 두드림: 앞 90 ms는 잡음(-36~-40 dB)이고 "깡"은 90 ms에 시작 → 88 ms부터 써야 타격 순간에 들림
    # 찌그러짐: 첫 큰 소리가 30 ms → 20 ms부터
    tap_n = peak_to(fade(cut(tap, 88), 2, 20), 0)
    crush_n = peak_to(fade(cut(crush, 20), 2, 30), 0)
    bat_swing, bat_hit = load("bat_swing"), load("bat_hit")
    motor, press, release = load("press_motor"), load("press_press"), load("press_release")

    # 프레스 crush 🔁: 0.45s~1.95s(1.5초) 동안 재생, 크기 0.3→1. 찌그러짐 앞 280 ms 조각을
    # 음높이·간격을 조금씩 바꿔 1.5초에 흩뿌림(고정 시드) + 프레스 누르는 저음
    rng = np.random.default_rng(7)
    piece = fade(cut(crush_n, 0, 280), 2, 60)
    layers, at = [], 0
    while at < 1500:
        layers.append((pitch(piece, rng.uniform(0.85, 1.15)), rng.uniform(-9, -2), at))
        at += rng.uniform(180, 320)
    crinkle = mix(*layers)[: ms(1580)]
    rumble = cut(press, 300, 1880)
    crush_loop = seamless(mix((peak_to(crinkle, 0), 0, 0), (peak_to(rumble, 0), -8, 0))[: ms(1580)])

    l_start, l_burn, l_end = load("laser_start"), load("laser_burn"), load("laser_end")

    b_fuse, b_boom = load("bomb_fuse"), load("bomb_explode")
    rub, box_tap = load("cardboard_rub"), load("cardboard_tap")
    # 빈 칸 채우기 (2026-11-07 사용자가 미리듣기 후보 A/B/C 중 모두 B 선택)
    beam_top = seamless(cut(load("laser_start"), 880, 1180), 40)
    fills = {
        # 배트 knock: 판지 상자 문지름 140~540 ms, 고음 깎아 둔하게 (책상에 밀리는 느낌, 앱이 0.8 볼륨으로 재생)
        "_common/bat/knock.wav": peak_to(fade(lowpass(cut(rub, 140, 540), 3000, SR), 5, 120), -6),
        # 레이저 beam 🔁: 충전음 가장 높은 부분 반복을 0.6배로 낮추고 고음 깎음 → 낮은 '웅'
        # (sound 브랜치 엔진의 laser main_action '사용 안 함'과 별개로 웹 앱 빔 칸만 채움)
        "_common/laser/beam.wav": peak_to(lowpass(pitch(beam_top, 0.6), 2000, SR), -10),
        # 폭탄 place: 판지 상자 치는 소리 '툭'
        "_common/bomb/place.wav": peak_to(box_tap, -4),
    }
    boom = peak_to(fade(b_boom, 0, 300), 0)

    return {
        **fills,
        # 폭탄 (0 place + fuse🔁 → 1.60 explode → debris)
        # 도화선 🔁: 합성 치지직 2초 중 앞 1.68초를 이음새 없이 → 1.6초(도화선 시간과 같음)
        "_common/bomb/fuse.wav": peak_to(seamless(cut(b_fuse, 0, 1680)), -6),
        # 폭발: 합성 폭발음 전체 (공통)
        "_common/bomb/explode.wav": peak_to(boom, -1),
        # 캔 폭발: 폭발음 + 캔 찌그러짐·두드림 (폭발이 주, 캔이 그 안에서 들리게)
        "can/bomb/explode.wav": peak_to(mix((boom, 0, 0), (crush_n, -4, 0), (tap_n, -6, 0)), -1),

        # 레이저 (탭: 0 start + beam🔁 + burn🔁 → 0.26 cut → 0.56 end / 드래그: 닿는 동안 burn🔁, 0.15s 이상 간격 cut)
        # 켜짐: 합성 충전음은 1.2초라 길어서, 빔이 바로 켜지는 앱에 맞게 가장 높은 끝부분 850~1150 ms만
        "_common/laser/start.wav": peak_to(fade(cut(l_start, 850, 1150), 3, 120), -8),
        # 지짐 🔁: 합성 '치이익 + 작은 튀는 소리' 전체를 이음새 없이 (캔 전용 녹음 없음)
        "can/laser/burn.wav": peak_to(seamless(cut(l_burn, 40, 1240)), -4),
        # 잘림: 캔 두드림(금속이 갈라지는 '깡') + 지짐 앞 250 ms
        "can/laser/cut.wav": peak_to(mix((tap_n, 0, 0), (fade(cut(l_burn, 40, 290), 2, 80), -6, 0)), -1),
        # 꺼짐: 합성 전원 감쇠음
        "_common/laser/end.wav": peak_to(fade(l_end, 2, 60), -8),

        # 유압 프레스 (캔: 0.00 motor🔁 → 0.45 contact + crush🔁 → ~1.95 crunch → ~2.40 release)
        # 모터 🔁: 합성 모터음의 일정한 구간(1.0~1.8 s)을 이음새 없이. 배경이라 작게
        "_common/press/motor.wav": peak_to(seamless(cut(motor, 1000, 1880)), -12),
        # 판이 캔에 닿음: 캔 두드림
        "can/press/contact.wav": peak_to(tap_n, -3),
        "can/press/crush.wav": peak_to(crush_loop, -2),
        # 끝까지 납작: 찌그러짐 전체 + 두드림 (캔은 터지지 않고 이걸로 끝)
        "can/press/crunch.wav": peak_to(mix((crush_n, 0, 0), (tap_n, -2, 0)), -1),
        # 판이 올라감: 합성 '쿵 + 압력 해제 쉭 + 모터 꺼짐' 앞 1초
        "_common/press/release.wav": peak_to(fade(cut(release, 0, 1000), 2, 300), -6),

        # 배트 (150 ms에 타격, 캔은 2번째 타격에 깨짐)
        # 휘두름: 원본에서 가장 큰 부분이 150~220 ms → 50~200 ms를 써서 타격 순간(150 ms)에 끝나게
        "_common/bat/swing.wav": peak_to(fade(cut(bat_swing, 50, 200), 3, 30), -8),
        # "깡": 앞 50 ms 타격은 그대로, 그 뒤 울림은 600 ms에 -40 dB까지 빠르게 줄임 ("울림 더 작게" 반영).
        # 크기는 앞 50 ms 타격 피크 기준으로 맞춤(-8.4 dB = 직전 버전 타격 크기) → 울림만 작아지고 타격은 그대로
        # 2번째 타격은 슬로모션(0.35배)이라 1.2초 울림이 ~3.4초 저음 공명으로 늘어나 너무 컸음(사용자 피드백 2026-11-07)
        "can/bat/hit.wav": attack_to(ring_cut(cut(bat_hit, 10, 610), 50, 600, -40), 50, -8.4),
        # 1번째 타격(안 깨짐): 두드림 + 찌그러짐 앞 350 ms (망치보다 센 타격)
        "can/bat/damage.wav": peak_to(mix((tap_n, 0, 0), (fade(cut(crush_n, 0, 350), 0, 100), -2, 0)), -1),
        # 2번째 타격(깨짐): 찌그러짐 전체 + 한 겹 더(0.92배, 40 ms 뒤) + 두드림, 살짝 포화시켜 꽉 차게
        # (슬로모션에서 낮아져도 배트 울림보다 크게 들리도록, 사용자 피드백 2026-11-07)
        "can/bat/break.wav": peak_to(saturate(mix((crush_n, 0, 0), (pitch(crush_n, 0.92), -5, 40), (tap_n, -3, 0)), 2.5), -1),

        # 공통 휘두름: 원본 0~140 ms(가장 큰 부분이 끝쪽) → 타격 순간(140 ms)에 끝나게 30 ms 페이드
        "_common/hammer/swing.wav": peak_to(fade(cut(swing, 0, 140), 3, 30), -8),
        # 망치 타격음: 도구 소리라 보조 레이어로 물건 소리보다 낮게
        "can/hammer/hit.wav": peak_to(fade(hit, 0, 30), -5),
        # 찌그러짐(1~3번째 타격): 캔 두드림 "깡" + 찌그러짐 앞 280 ms
        "can/hammer/damage.wav": peak_to(mix((tap_n, 0, 0), (fade(cut(crush_n, 0, 280), 0, 80), -4, 0)), -1),
        # 깨짐(4번째 타격): 찌그러짐 전체 + 두드림
        "can/hammer/break.wav": peak_to(mix((crush_n, 0, 0), (tap_n, -3, 0)), -1),
        # 조각 떨어짐: 두드림을 짧게·높게(작은 조각) / 원래 길이·낮게(큰 조각)
        "can/debris/small.wav": peak_to(fade(pitch(cut(tap_n, 0, 140), 1.2), 0, 40), -10),
        "can/debris/small_2.wav": peak_to(fade(pitch(cut(tap_n, 0, 140), 1.4), 0, 40), -11),
        "can/debris/large.wav": peak_to(fade(pitch(tap_n, 0.85), 0, 40), -6),
    }


def build_laptop():
    """노트북 (Claude 판정 electronics·cracks → 마우스도 이 세트를 씀).

    물건 소리는 sound 브랜치 엔진(materialPresets.js)이 노트북에 고른 조합 그대로:
    타격 = 유리 두드림 + 키보드 키, 누름 = 유리 긁힘, 깨짐 = 유리 깨짐 + 키보드 키.
    노트북 외장(알루미늄·플라스틱 케이스) 전용 녹음은 없음 → 대체 소리.
    타이밍: 망치 3번째·배트 2번째(슬로모션 0.35배) 타격에 깨짐, 그 전 타격마다 작은 조각 3개.
    프레스는 0.45 s 닿고 ~1.12 s에 터짐(burst), crunch 없음.
    """
    # 음원 앞쪽 정리: 키보드 키는 앞 150 ms가 잡음(-27~-34 dB), 유리 두드림은 10 ms에서 시작,
    # 유리 긁힘은 150 ms부터 큰 소리
    key = peak_to(fade(cut(load("plastic_key"), 145), 2, 30), 0)
    gtap = peak_to(fade(cut(load("glass_tap"), 5), 2, 20), 0)
    scrape = peak_to(fade(cut(load("glass_scrape"), 140), 2, 30), 0)
    shatter = load("glass_shatter")
    shatter_long = peak_to(fade(cut(shatter, 0, 1400), 2, 400), 0)
    # 배트 2번째 타격은 슬로모션이라 0.35배로 늘어남 → 깨짐 꼬리를 짧게(1.0 s)
    shatter_short = peak_to(fade(cut(shatter, 0, 1000), 2, 300), 0)

    # 도구 소리 (캔과 같은 가공)
    hammer_hit = peak_to(fade(load("hammer_hit"), 0, 30), -5)
    bat_hit = attack_to(ring_cut(cut(load("bat_hit"), 10, 610), 50, 600, -40), 50, -8.4)
    l_burn = load("laser_burn")
    boom = peak_to(fade(load("bomb_explode"), 0, 300), 0)
    rumble = peak_to(cut(load("press_press"), 300, 1880), 0)

    # 프레스 crush 🔁: 0.45~1.12 s(약 0.67 s) → 유리 긁힘 0.72 s + 누르는 저음, 이음새 없이 0.66 s
    crush_loop = seamless(mix((cut(scrape, 0, 720), 0, 0), (cut(rumble, 0, 720), -8, 0))[: ms(720)], 60)

    return {
        # 망치
        "laptop/hammer/hit.wav": hammer_hit,
        # 금 감(1·2번째): 유리 두드림 + 키보드 키
        "laptop/hammer/damage.wav": peak_to(mix((gtap, 0, 0), (key, -3, 0)), -1),
        # 깨짐(3번째): 유리 깨짐 1.4 s + 키보드 키 + 유리 두드림
        "laptop/hammer/break.wav": peak_to(mix((shatter_long, 0, 0), (key, -4, 0), (gtap, -6, 0)), -1),
        # 배트
        "laptop/bat/hit.wav": bat_hit,
        # 1번째(안 깨짐): 망치보다 세게 → 키보드 키를 더 크게
        "laptop/bat/damage.wav": peak_to(mix((gtap, 0, 0), (key, -1, 0)), -1),
        # 2번째(깨짐, 슬로모션): 유리 깨짐 1.0 s + 키보드 키, 살짝 포화(캔 배트 피드백과 같은 이유)
        "laptop/bat/break.wav": peak_to(saturate(mix((shatter_short, 0, 0), (key, -3, 0), (gtap, -5, 0)), 2.0), -1),
        # 프레스
        "laptop/press/contact.wav": peak_to(mix((key, 0, 0), (gtap, -6, 0)), -3),
        "laptop/press/crush.wav": peak_to(crush_loop, -2),
        # 터짐: 유리 깨짐 1.4 s + 키보드 키 + 누르는 저음 앞 300 ms
        "laptop/press/burst.wav": peak_to(mix((shatter_long, 0, 0), (key, -3, 0), (fade(cut(rumble, 0, 300), 2, 150), -8, 0)), -1),
        # 레이저
        "laptop/laser/burn.wav": peak_to(seamless(cut(l_burn, 40, 1240)), -4),
        # 잘림: 유리 두드림 + 키보드 키 + 지짐 앞 250 ms
        "laptop/laser/cut.wav": peak_to(mix((gtap, 0, 0), (key, -6, 0), (fade(cut(l_burn, 40, 290), 2, 80), -6, 0)), -1),
        # 폭탄: 폭발이 주, 유리 깨짐·키보드 키가 그 안에서
        "laptop/bomb/explode.wav": peak_to(mix((boom, 0, 0), (shatter_long, -4, 0), (key, -8, 0)), -1),
        # 조각: 작은 유리 조각(높게)·플라스틱 조각 / 큰 덩어리(키보드 키 낮게 + 유리)
        "laptop/debris/small.wav": peak_to(fade(pitch(cut(gtap, 0, 100), 1.3), 0, 30), -10),
        "laptop/debris/small_2.wav": peak_to(fade(pitch(cut(key, 0, 100), 1.2), 0, 30), -11),
        "laptop/debris/small_3.wav": peak_to(fade(pitch(cut(gtap, 0, 100), 1.6), 0, 30), -12),
        "laptop/debris/large.wav": peak_to(mix((fade(pitch(cut(key, 0, 200), 0.85), 0, 50), 0, 0), (gtap, -6, 0)), -6),
    }


def build_book():
    """책 (Claude 판정 paper·tears). 타이밍은 노트북과 같음: 망치 3번째·배트 2번째(슬로모션) 깨짐,
    그 전 타격마다 작은 조각 2개, 프레스 0.45 s 닿고 ~1.12 s 터짐.

    물건 소리는 sound 브랜치 엔진이 책에 고른 조합: 타격 = 종이 구김 + 판지 두드림,
    누름 = 종이 구김, 깨짐 = 종이 찢김 + 구김.
    """
    # 음원 앞쪽 정리: 찢김은 앞 260 ms가 잡음(-38~-48 dB), 구김은 80 ms에 시작
    tear = peak_to(fade(cut(load("paper_tear"), 250), 2, 30), 0)
    crumple = peak_to(fade(cut(load("paper_crumple"), 70), 2, 30), 0)
    box = peak_to(load("cardboard_tap"), 0)
    ptap = peak_to(load("paper_tap"), 0)

    hammer_hit = peak_to(fade(load("hammer_hit"), 0, 30), -5)
    bat_hit = attack_to(ring_cut(cut(load("bat_hit"), 10, 610), 50, 600, -40), 50, -8.4)
    l_burn = load("laser_burn")
    boom = peak_to(fade(load("bomb_explode"), 0, 300), 0)
    rumble = peak_to(cut(load("press_press"), 300, 1880), 0)

    def part(x, a, b, out=100):
        return fade(cut(x, a, b), 2, out)

    crush_loop = seamless(mix((cut(crumple, 0, 720), 0, 0), (cut(rumble, 0, 720), -8, 0))[: ms(720)], 60)
    # 망치용 둔탁한 표지 '퍽': 판지 두드림 + 낮게(0.8배)·고음 깎은 한 겹으로 몸통을 두껍게, 살짝 포화해 더 크게
    thud = saturate(mix((box, 0, 0), (lowpass(pitch(box, 0.8), 1500, SR), -2, 0)), 2.0)
    # 망치용 둔탁한 구김: 0.9배로 낮추고 2.5 kHz 위를 깎아 바스락거림을 줄임 → 크게 넣어도 거슬리지 않게 (사용자 피드백)
    # 구김은 첫 소리만 크고 뒤가 작아서, 포화(tanh 3.0)로 뒤쪽을 끌어올림
    dull_crumple = peak_to(saturate(lowpass(pitch(crumple, 0.9), 2500, SR), 3.0), 0)

    return {
        # 망치
        # 망치 타격음은 책에선 뒤로: 표지 '퍽'(판지 두드림) 위주로 (사용자 피드백 2026-11-07, -15 → -18 dB)
        "book/hammer/hit.wav": peak_to(fade(load("hammer_hit"), 0, 30), -18),
        # 1·2번째: 둔탁한 표지 '퍽' 위주 + 둔탁한 구김 350 ms (-4 dB)
        "book/hammer/damage.wav": peak_to(mix((thud, 0, 0), (part(dull_crumple, 0, 350), -4, 0)), -1),
        # 3번째(깨짐): 둔탁한 '퍽' 위주 + 찢김은 0.45 s로 짧게(1.2 s는 너무 길다는 피드백) + 둔탁한 구김 0.3 s (-4 dB)
        "book/hammer/break.wav": peak_to(mix((thud, 0, 0), (part(tear, 0, 450, 200), -5, 0), (part(dull_crumple, 0, 300, 120), -4, 0)), -1),
        # 배트
        "book/bat/hit.wav": bat_hit,
        "book/bat/damage.wav": peak_to(mix((box, 0, 0), (part(crumple, 0, 450), -2, 0)), -1),
        # 2번째(깨짐, 슬로모션 0.35배): 찢김 0.8 s로 짧게 + 구김 + 판지, 살짝 포화
        "book/bat/break.wav": peak_to(saturate(mix((part(tear, 0, 800, 300), 0, 0), (part(crumple, 0, 400), -4, 0), (box, -3, 0)), 2.0), -1),
        # 프레스
        "book/press/contact.wav": peak_to(mix((box, 0, 0), (ptap, -6, 0)), -3),
        # crush 🔁 0.45~1.12 s: 구김 0.72 s + 누르는 저음, 이음새 없이 0.66 s
        "book/press/crush.wav": peak_to(crush_loop, -2),
        # 터짐: 찢김 1.0 s + 구김 + 판지 + 누르는 저음 앞 300 ms
        "book/press/burst.wav": peak_to(mix((part(tear, 0, 1000, 300), 0, 0), (part(crumple, 0, 500), -3, 0), (box, -3, 0), (part(rumble, 0, 300, 150), -8, 0)), -1),
        # 레이저
        "book/laser/burn.wav": peak_to(seamless(cut(l_burn, 40, 1240)), -4),
        # 잘림: 종이 두드림 + 찢김 앞 200 ms + 지짐 앞 250 ms
        "book/laser/cut.wav": peak_to(mix((ptap, 0, 0), (part(tear, 0, 200, 80), -4, 0), (part(l_burn, 40, 290, 80), -6, 0)), -1),
        # 폭탄: 폭발이 주, 찢김·구김이 그 안에서
        "book/bomb/explode.wav": peak_to(mix((boom, 0, 0), (part(tear, 0, 1000, 300), -6, 0), (part(crumple, 0, 600, 200), -6, 0)), -1),
        # 조각: 종이 조각은 가볍고 조용하게 / 큰 덩어리는 판지 '툭'
        "book/debris/small.wav": peak_to(fade(pitch(cut(ptap, 0, 100), 1.2), 0, 30), -12),
        "book/debris/small_2.wav": peak_to(fade(pitch(cut(crumple, 0, 100), 1.1), 0, 30), -13),
        "book/debris/large.wav": peak_to(fade(pitch(box, 0.9), 0, 40), -6),
    }


BUILDERS = {"can": build_can, "laptop": build_laptop, "book": build_book}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", required=True, help="web 앱 폴더 (package.json 있는 곳)")
    ap.add_argument("--only", choices=sorted(BUILDERS), action="append")
    args = ap.parse_args()
    out_root = os.path.join(args.web, "public", "sounds")
    for name in args.only or sorted(BUILDERS):
        for rel, x in BUILDERS[name]().items():
            path = os.path.join(out_root, *rel.split("/"))
            save_wav(path, x, SR)
            pk = 20 * np.log10(np.abs(x).max())
            print(f"{rel:30s} {len(x) / SR:6.3f}s  peak {pk:5.1f} dB")


if __name__ == "__main__":
    main()
