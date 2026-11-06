"""sounds/catalog.json 을 읽어 버튼으로 바로 들어볼 수 있는 sounds/player.html 을 만든다.

실행: python scripts/build_player.py   (프로젝트 루트에서)
브라우저에서 sounds/player.html 을 더블클릭해 열면 된다(서버 불필요).
"""
import html
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TOOLS = [
    ("hydraulic_press", "유압 프레스"),
    ("hammer", "망치"),
    ("aluminum_bat", "알루미늄 배트"),
    ("laser", "레이저"),
    ("bomb", "폭탄"),
]
ROLES = [
    ("activation", "준비·시작"),
    ("main_action", "핵심 동작"),
    ("impact_detail", "세부"),
    ("finish", "종료·잔향"),
]

TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>효과음 재생기</title>
<style>
  :root {
    --bg: #f6f5f2; --card: #ffffff; --text: #1d1d1f; --muted: #6b6b70;
    --line: #e3e1dc; --btn: #f0eee9; --btn-hover: #e6e3dc; --accent: #d9480f; --accent-text: #fff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #151517; --card: #1f1f22; --text: #f2f2f3; --muted: #9a9aa1;
      --line: #2e2e33; --btn: #2a2a2f; --btn-hover: #34343a; --accent: #ff6b2c; --accent-text: #111;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 28px 16px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; font-size: 14px; }
  .bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; }
  .now { color: var(--muted); font-size: 14px; min-height: 1.5em; }
  .tool { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 14px; margin-bottom: 12px; }
  .tool-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .tool-head h2 { font-size: 16px; margin: 0; }
  .tool-head code { color: var(--muted); font-size: 12px; margin-left: 6px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  @media (max-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--line);
    background: var(--btn); border-radius: 10px; padding: 10px 12px; text-align: left; }
  button:hover { background: var(--btn-hover); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .snd .role { display: block; font-weight: 600; }
  .snd .desc { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
  .snd.playing { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .snd.missing { opacity: .45; cursor: default; }
  .seq { background: var(--accent); color: var(--accent-text); border-color: transparent;
    font-weight: 600; padding: 8px 12px; white-space: nowrap; }
  .seq:hover { background: var(--accent); filter: brightness(1.08); }
  .plain { padding: 8px 12px; }
  h3 { font-size: 15px; margin: 26px 0 10px; }
</style>
</head>
<body>
<main>
  <h1>효과음 재생기</h1>
  <p class="sub">버튼을 누르면 바로 재생됩니다. 다른 버튼을 누르면 이전 소리는 멈춥니다. "순서대로"는 준비 → 핵심 → 세부 → 종료를 이어서 들려줍니다.</p>
  <div class="bar">
    <button class="plain" id="stop">■ 정지</button>
    <span class="now" id="now"></span>
  </div>
  __TOOLS__
  __PROVIDED__
</main>
<script>
  const audio = new Audio();
  const now = document.getElementById('now');
  let queue = [];
  let activeBtn = null;

  function mark(btn) {
    if (activeBtn) activeBtn.classList.remove('playing');
    activeBtn = btn;
    if (btn) btn.classList.add('playing');
  }
  function play(btn) {
    audio.pause();
    audio.src = btn.dataset.src;
    audio.currentTime = 0;
    mark(btn);
    now.textContent = '재생 중: ' + btn.dataset.label;
    audio.play().catch(() => { now.textContent = '재생 실패: ' + btn.dataset.src; mark(null); });
  }
  function stop() {
    queue = []; audio.pause(); mark(null); now.textContent = '';
  }
  audio.addEventListener('ended', () => {
    if (queue.length) { play(queue.shift()); }
    else { mark(null); now.textContent = ''; }
  });
  document.querySelectorAll('.snd[data-src]').forEach(b =>
    b.addEventListener('click', () => { queue = []; play(b); }));
  document.querySelectorAll('.seq').forEach(b =>
    b.addEventListener('click', () => {
      const list = [...document.querySelectorAll('.snd[data-src][data-tool="' + b.dataset.tool + '"]')];
      if (!list.length) return;
      queue = list.slice(1); play(list[0]);
    }));
  document.getElementById('stop').addEventListener('click', stop);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') stop(); });
</script>
</body>
</html>
"""


MATERIALS = [
    ("cardboard", "판지"),
    ("paper", "종이"),
    ("aluminum", "알루미늄"),
    ("plastic", "플라스틱"),
    ("glass", "유리"),
    ("ceramic", "도자기"),
    ("unknown", "재질 미정"),
]
ACTION_NAMES = {
    "tap": "두드림", "rub": "문지름", "scrape": "긁음", "tear": "찢음", "crumple": "구김",
    "crush": "찌그러뜨림", "key_press": "키 누름", "impact": "충격", "shatter": "깨짐",
}


def disabled_roles():
    """엔진 설정(src/audio/presets/toolPresets.js)의 disabledRoles를 읽는다."""
    import re
    try:
        src = open(os.path.join(ROOT, "src", "audio", "presets", "toolPresets.js"), encoding="utf-8").read()
    except OSError:
        return {}
    out = {}
    for tool, body in re.findall(r"^  (\w+): \{\s*\n\s*disabledRoles: \[([^\]]*)\]", src, re.M):
        out[tool] = set(re.findall(r"'(\w+)'", body))
    return out


def esc(s):
    return html.escape(str(s or ""), quote=True)


def main():
    with open(os.path.join(ROOT, "sounds", "catalog.json"), encoding="utf-8") as f:
        catalog = json.load(f)
    sounds = catalog["sounds"]
    materials = catalog.get("material_sounds", [])

    def src(s):
        return "../" + s["file_path"]

    off = disabled_roles()
    blocks = []
    for code, name in TOOLS:
        btns = []
        for role, rname in ROLES:
            if role in off.get(code, ()):
                btns.append(f'<button class="snd missing" disabled><span class="role">{rname}</span>'
                            f'<span class="desc">사용 안 함</span></button>')
                continue
            hit = next((s for s in sounds if s.get("tool_code") == code and s.get("sound_role") == role), None)
            if hit:
                btns.append(
                    f'<button class="snd" data-tool="{code}" data-src="{esc(src(hit))}" '
                    f'data-label="{esc(name + " · " + rname)}" title="{esc(hit["sound_id"])}">'
                    f'<span class="role">{rname}</span><span class="desc">{esc(hit["description"])}</span></button>'
                )
            else:
                btns.append(f'<button class="snd missing" disabled><span class="role">{rname}</span>'
                            f'<span class="desc">아직 없음</span></button>')
        blocks.append(
            f'<section class="tool"><div class="tool-head"><h2>{name}<code>{code}</code></h2>'
            f'<button class="seq" data-tool="{code}">▶ 순서대로</button></div>'
            f'<div class="grid">{"".join(btns)}</div></section>'
        )

    provided = [s for s in sounds if s.get("source_type") == "provided_audio" and not s.get("tool_code")]
    prov_html = ""
    if provided:
        btns = "".join(
            f'<button class="snd" data-tool="provided" data-src="{esc(src(s))}" '
            f'data-label="{esc(s["description"])}" title="{esc(s["sound_id"])}">'
            f'<span class="role">{esc(s["description"])}</span><span class="desc">{esc(s["sound_id"])}</span></button>'
            for s in provided
        )
        prov_html = f'<h3>받은 음원 (도구·역할 미정)</h3><section class="tool"><div class="grid">{btns}</div></section>'

    mat_html = ""
    if materials:
        mat_html = '<h3>재질 효과음 (실제 재질·동작 라벨)</h3>'
        for code, name in MATERIALS:
            rows = [m for m in materials if m.get("material_code", "unknown") == code]
            if not rows:
                continue
            btns = []
            for m in rows:
                flag = " · 검토 필요" if m.get("status") != "ready" else ""
                act = ACTION_NAMES.get(m.get("action"), m.get("action") or "?")
                if m.get("repeat_count"):
                    act += f" ×{m['repeat_count']}"
                btns.append(
                    f'<button class="snd" data-tool="mat_{code}" data-src="{esc(src(m))}" '
                    f'data-label="{esc(name + " · " + m["description"])}" title="{esc(m["sound_id"])}">'
                    f'<span class="role">{esc(act)}{flag}</span><span class="desc">{esc(m["description"])}<br>'
                    f'<code>{esc(m.get("label") or m["sound_id"])}</code></span></button>'
                )
            mat_html += (f'<section class="tool"><div class="tool-head"><h2>{name}<code>{code}</code></h2>'
                         f'<button class="seq" data-tool="mat_{code}">▶ 순서대로</button></div>'
                         f'<div class="grid">{"".join(btns)}</div></section>')

    out = (TEMPLATE.replace("__TOOLS__", "\n  ".join(blocks))
           .replace("__PROVIDED__", prov_html + mat_html))
    path = os.path.join(ROOT, "sounds", "player.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    print("wrote", path)


if __name__ == "__main__":
    main()
