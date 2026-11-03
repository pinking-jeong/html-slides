"""덱 편집기 — PPTX 받기가 화면(원본)의 모습을 지키는가: 글상자·도형의 자리를 덱 요소의 화면 자리와 대조한다(Playwright).
실제 덱('확장형 크롤러의 편향은 …' 통합 발표)을 PowerPoint 로 열었더니 틀어졌던 구조를 줄인 시험 덱으로 —
목차 격자(ol > li > a 격자), 세로 flex 카드, 칩, 글머리표 목록(li 사이 줄바꿈), 둥근 칸 격자 표, 링 아이콘(box-shadow),
슬라이더, 스크립트가 만드는 쪽 번호."""
import re

from playwright.sync_api import expect

from test_editor import (  # noqa: F401 — browser·serve 는 fixture
    DeckHub, browser, make_site, open_editor, serve,
)
from test_editor_pptx import clean, shapes, slides, take, texts

EMU = 9525   # 1 CSS px

FID = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>충실도 시험 덱</title>
<style>
body{margin:0;background:#0b1220;font-family:"Malgun Gothic",sans-serif}
.stage{position:fixed;inset:0;display:grid;place-items:center}
.deck{position:relative;width:1280px;height:720px;background:#FFFFFF}
.slide{position:absolute;inset:0;padding:56px 72px 48px;display:none;overflow:hidden;background:#fcfcfb;color:#0b0b0b}
.slide.on{display:block}
h2{margin:0 0 16px;font-size:40px;line-height:1.2}
.card{position:absolute;left:80px;top:140px;width:321px;height:347px;box-sizing:border-box;padding:23px 23px 0;background:#0b0b0b;border-radius:16px;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.2)}
.card h3{margin:0 0 12px;font-size:20px}
.uses{display:flex;flex-direction:column;gap:7px;margin:0;padding:0;list-style:none}
.uses li{position:relative;padding-left:17px;font-size:14px;line-height:1.45;color:#ecebe5}
.uses li::before{content:"";position:absolute;left:0;top:.55em;width:7px;height:7px;border-radius:50%;background:#1baf7a}
.agenda{position:absolute;left:460px;top:140px;width:640px;margin:0;padding:0;list-style:none;display:grid;grid-template-columns:300px 300px;grid-auto-flow:column;grid-template-rows:repeat(3,70px);gap:12px 20px}
.agenda li{display:flex;border:1px solid #ddd;border-radius:10px;background:#fff}
.agenda a{display:grid;grid-template-columns:52px 1fr;align-items:center;column-gap:8px;padding:0 12px;text-decoration:none;color:inherit;width:100%}
.agenda .n{grid-row:1 / span 2;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#e6f6ef;color:#0a7a52;font-weight:700}
.agenda b{font-size:16px;align-self:end}
.agenda small{font-size:12px;color:#666;align-self:start}
.qgrid{position:absolute;left:80px;top:520px;display:flex;gap:16px}
.qcard{position:relative;display:flex;flex-direction:column;align-items:center;width:200px;height:150px;box-sizing:border-box;padding:48px 10px 10px;border:1px solid #ddd;border-radius:12px;background:#fff;text-align:center}
.qn{position:absolute;left:10px;top:10px;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#eb6834;color:#fff;font-size:12px}
.qcard b{margin-top:8px;font-size:16px}
.qcard .qc{font-size:12px;color:#666}
.qcard .qd{margin-top:auto;padding:3px 10px;border-radius:999px;background:#f0efec;font-size:11px}
.chips{position:absolute;left:460px;top:420px;display:flex;justify-content:center;width:640px;margin:0;padding:0;list-style:none}
.chips li{padding:8px 20px;border-radius:999px;background:#f0efec;font-size:14px;color:#52514e}
.armx{position:absolute;left:460px;top:500px;border-collapse:separate;border-spacing:6px}
.armx td{width:44px;height:30px;text-align:center;font-weight:700;border-radius:10px;background:#e8f1fc}
.armx td.o{background:#fdeee7}
.ring{position:absolute;left:1000px;top:600px;width:40px;height:40px;border-radius:50%;background-image:radial-gradient(circle,#1baf7a 0,#1baf7a 5px,transparent 6px);box-shadow:inset 0 0 0 2px #1baf7a,0 0 0 5px #fff,0 0 0 7px #1baf7a}
.rng{position:absolute;left:760px;top:600px;margin:0;font-size:12px}
.rng input{width:150px;accent-color:#1baf7a;vertical-align:middle}
.two{position:absolute;left:460px;top:600px;width:150px;margin:0;font-size:24px;line-height:1.2}
.pg{position:absolute;right:28px;bottom:14px;font-size:12px;color:#898781}
table.plain{position:absolute;left:100px;top:200px}
.pad{position:absolute;left:980px;top:580px;width:80px;height:80px;background:#123456}
.hard{position:absolute;left:100px;top:360px;width:200px;height:60px;box-sizing:border-box;padding:8px;border:2px solid #000;background:transparent;box-shadow:6px 6px 0 #cc3333}
.outl{position:absolute;left:380px;top:360px;width:200px;height:60px;box-sizing:border-box;padding:8px;box-shadow:0 0 0 3px #3366cc}
.glow{position:absolute;left:660px;top:360px;width:160px;height:60px;box-sizing:border-box;padding:8px;background:#fff;box-shadow:0 0 24px rgba(0,0,0,.3)}
.side{position:absolute;left:900px;top:360px;width:160px;height:60px;box-sizing:border-box;padding:8px;background:#fff;box-shadow:12px 0 16px rgba(0,0,0,.4)}
.mix{position:absolute;left:100px;top:470px;width:360px;margin:0;font-size:16px;line-height:1.5}
.ctn{position:absolute;left:520px;top:470px;width:200px;height:150px;display:flex;flex-direction:column;gap:40px;font-size:16px}
.cs{position:absolute;left:100px;top:640px;margin:0}
.cs input{-webkit-appearance:none;appearance:none;width:150px;height:6px;background:#333333;border-radius:3px}
.rtl{position:absolute;left:300px;top:640px;margin:0}
.rtl input{width:150px;accent-color:#1baf7a}
.bal{position:absolute;left:520px;top:630px;width:460px;margin:0;font-size:28px;line-height:1.3;text-wrap:balance}
table.corner{position:absolute;left:760px;top:470px;border-collapse:separate;border-spacing:0}
table.corner th{background:#eeeeee;padding:6px 14px}
table.corner th:first-child{border-top-left-radius:10px}
table.corner td{padding:6px 14px;border-bottom:1px solid #999999}
</style></head><body>
<div class="stage"><div class="deck">
<section class="slide on" data-notes="첫 장 노트"><h2>충실도 시험</h2>
<div class="card"><h3>지식그래프로 엮는다</h3>
<ul class="uses">
  <li>흩어진 정황을 시설 · 공정 · 징후 단위로 잇는다</li>
  <li>판단의 근거를 원래 출처까지 거슬러 확인한다</li>
  <li>위성영상 판독관의 판단을 돕는다</li>
</ul></div>
<ol class="agenda">
  <li><a href="#"><span class="n">1</span><b>배경</b><small>공개출처 지식그래프</small></a></li>
  <li><a href="#"><span class="n">2</span><b>방법</b><small>네 물음 · 사건과 매체</small></a></li>
  <li><a href="#"><span class="n">3</span><b>결과</b><small>네 물음의 답</small></a></li>
  <li><a href="#"><span class="n">4</span><b>해석</b><small>관리하며 쓰는 도구</small></a></li>
  <li><a href="#"><span class="n">5</span><b>한계</b><small>최소 검출 폭</small></a></li>
  <li><a href="#"><span class="n">6</span><b>요약</b><small>한 장 요약</small></a></li>
</ol>
<ul class="chips"><li>민감도 분석 · 매체 하나 빼기에서 <b>모두 + 쪽이었다</b></li></ul>
<table class="armx"><tbody><tr><td>3</td><td>4</td><td>2</td></tr><tr><td class="o">4</td><td class="o">2</td><td class="o">4</td></tr></tbody></table>
<div class="qgrid"><a class="qcard"><span class="qn">1</span><b>나라 · 진영</b><span class="qc">러중 − 한미일</span><span class="qd">1단계 R0 글</span></a><a class="qcard"><span class="qn">2</span><b>소유 구조</b><span class="qc">공적 − 민간</span><span class="qd">2단계 R1 글</span></a></div>
<div class="pad"></div><span class="ring"></span>
<p class="rng">라운드 <input type="range" min="0" max="6" value="3"> 3번</p>
<p class="two">두 줄로 꺾이는 문단입니다 두 줄로 꺾이는 문단</p>
</section>
<section class="slide" data-notes="둘째 노트"><h2>둘째 장</h2><table class="plain"><thead><tr><th>머리</th></tr></thead><tbody><tr><td>칸</td></tr></tbody></table>
<div class="hard">단단한 그림자</div><div class="outl">테두리 고리</div><div class="glow">번짐</div><div class="side">옆으로</div>
<p class="mix"><svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="#c33"/></svg> 위성영상 판독관이 <b>공개출처</b> 정황을 시설과 공정과 징후 단위로 엮어 판단의 근거를 원래 출처까지 거슬러 확인한다</p>
<div class="ctn">바깥 글<div style="display:contents"><p style="margin:0">첫째 안쪽</p><p style="margin:0">둘째 안쪽</p></div></div>
<p class="cs"><input type="range" min="0" max="4" value="2"></p>
<p class="rtl"><input type="range" dir="rtl" min="0" max="4" value="1"></p>
<p class="bal">조건을 끄고 켜며 기대값을 다시 계산하기</p>
<table class="corner"><thead><tr><th>가</th><th>나</th><th>다</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>
</section>
</div></div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')), i=0;
  function go(n){ i=Math.max(0,Math.min(slides.length-1,n)); slides.forEach(function(s,k){ s.classList.toggle('on',k===i); }); }
  // 쪽 번호 — 스크립트가 쪽마다 만든다(편집기 화면은 스크립트를 돌리지 않는다)
  slides.forEach(function(s,k){ var pg=document.createElement('div'); pg.className='pg'; pg.textContent=String(k+1); s.appendChild(pg); });
  window.__deck={go:go};
  go(0);
})();
</script>
</body></html>
"""

RECT = """(sel) => { const s = document.querySelector('section.slide.on'); const e = s.querySelector(sel);
  if (!e) return null; const r = e.getBoundingClientRect(); const r0 = s.getBoundingClientRect();
  return { x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height }; }"""


def dom(page, sel):
    """덱 요소의 화면 자리(장 안, CSS px) — 편집 화면의 iframe 은 1280×720 그대로"""
    return page.query_selector("#frame").content_frame().evaluate(RECT, sel)


def box(sp):
    """도형(p:sp)의 자리(CSS px) {x, y, w, h}"""
    m = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', sp)
    x, y, w, h = (int(v) / EMU for v in m.groups())
    return {"x": x, "y": y, "w": w, "h": h}


def with_text(xml, t):
    return next(sp for sp in shapes(xml) if f"<a:t>{t}</a:t>" in sp)


def near(a, b, tol):
    return abs(a - b) <= tol


def corner_number(xml, t):
    """오른쪽 아래 모서리(오른쪽 끝 > 1180px, 위 > 640px)에 놓인 글상자 중 글이 t 인 것의 자리, 없으면 None"""
    for sp in shapes(xml):
        if f"<a:t>{t}</a:t>" in sp:
            b = box(sp)
            if b["x"] + b["w"] > 1180 and b["y"] > 640:
                return b
    return None


def export(browser, tmp_path, serve, deck=FID):
    site, root = make_site(tmp_path, {"fid.html": deck})
    base = serve(site)
    hub = DeckHub({"decks/fid.html": (root / "decks" / "fid.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "fid", hub)
    name, z = take(page, tmp_path)
    return ctx, page, errors, slides(z)


def test_agenda_grid_keeps_every_text_at_its_own_place(browser, tmp_path, serve):
    """ol > li > a(grid) 목차 — 번호·제목·설명이 항목마다 제 자리에(예전엔 ol 전체가 글상자 하나로 합쳐져 흩어졌다)"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    assert all(clean(x) for x in (s1, s2))
    for li, (title, desc) in ((1, ("배경", "공개출처 지식그래프")), (4, ("해석", "관리하며 쓰는 도구")), (6, ("요약", "한 장 요약"))):
        want_b = dom(page, f".agenda li:nth-child({li}) b")
        want_n = dom(page, f".agenda li:nth-child({li}) .n")
        want_s = dom(page, f".agenda li:nth-child({li}) small")
        # 번호 글("1"·"4"·"6")은 다른 곳에도 있다 — 번호 원 자리에 놓인 글상자를 자리로 찾는다
        n = next(b for b in (box(sp) for sp in shapes(s1) if f"<a:t>{li}</a:t>" in sp)
                 if near(b["x"], want_n["x"], 3) and near(b["y"], want_n["y"], 3))
        b, s = box(with_text(s1, title)), box(with_text(s1, desc))
        assert near(b["x"], want_b["x"], 3) and near(b["y"], want_b["y"], 3), (title, b, want_b)
        assert near(s["x"], want_s["x"], 3) and near(s["y"], want_s["y"], 3), (desc, s, want_s)
        assert n["w"] <= want_n["w"] + 2 and n["h"] <= want_n["h"] + 2, (li, n, want_n)
    # 여섯 항목의 번호 원·카드 도형도 그대로(원 6 + 카드 6 × 2 줄 도형이 아니라 바탕·테두리)
    assert len([sp for sp in shapes(s1) if 'prst="ellipse"' in sp and 'val="E6F6EF"' in sp]) == 6
    ctx.close()
    assert errors == []


def test_vertical_cards_keep_title_subtitle_and_chip_at_their_places(browser, tmp_path, serve):
    """세로 flex 카드(번호·아이콘·제목·부제·칩) — 글을 위에서부터 이어 붙이지 않고 화면 자리에"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    for k, (title, sub, chip_text) in enumerate((("나라 · 진영", "러중 − 한미일", "1단계 R0 글"),
                                                  ("소유 구조", "공적 − 민간", "2단계 R1 글")), 1):
        for sel, t in (("b", title), (".qc", sub)):
            want = dom(page, f".qgrid .qcard:nth-child({k}) {sel}")
            got = box(with_text(s1, t))
            assert near(got["y"], want["y"], 3), (t, got, want)
            assert near(got["x"] + got["w"] / 2, want["x"] + want["w"] / 2, 4), (t, got, want)
        chip = dom(page, f".qgrid .qcard:nth-child({k}) .qd")
        sp = with_text(s1, chip_text)
        g = box(sp)
        # 칩 글은 칩 상자 안에, 위아래 가운데(anchor=ctr)
        assert near(g["y"] + g["h"] / 2, chip["y"] + chip["h"] / 2, 3) and 'anchor="ctr"' in sp, (g, chip)
    ctx.close()
    assert errors == []


def test_chip_text_sits_inside_its_pill(browser, tmp_path, serve):
    """flex 줄의 알약(li 에 안쪽 여백·배경) — 글이 알약 위쪽 바깥으로 올라가지 않고 알약 가운데에"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    pill = dom(page, ".chips li")
    sp = with_text(s1, "민감도 분석 · 매체 하나 빼기에서 ")
    g = box(sp)
    assert near(g["y"] + g["h"] / 2, pill["y"] + pill["h"] / 2, 3) and 'anchor="ctr"' in sp, (g, pill)
    assert g["x"] >= pill["x"] - 1 and g["x"] + g["w"] <= pill["x"] + pill["w"] + 1, (g, pill)
    ctx.close()
    assert errors == []


def test_whitespace_between_list_items_makes_no_empty_paragraph(browser, tmp_path, serve):
    """<li> 사이의 들여쓰기·줄바꿈(공백 글 조각)이 빈 문단이 되어 글을 아래로 밀지 않는다"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    sp = with_text(s1, "흩어진 정황을 시설 · 공정 · 징후 단위로 잇는다")
    paras = re.findall(r"<a:p>.*?</a:p>", sp, re.S)
    assert len(paras) == 3, len(paras)                                  # 세 항목 = 세 문단(사이 공백이 빈 문단이 되지 않았다)
    assert all("<a:t>" in p for p in paras)
    ctx.close()
    assert errors == []


def test_rounded_spaced_grid_table_is_drawn_as_cell_shapes_but_plain_tables_stay_tables(browser, tmp_path, serve):
    """칸이 둥글고 칸 사이가 떨어진 행렬 표는 칸마다 도형으로(PowerPoint 표는 둥근 칸·칸 사이를 못 그린다), 보통 표는 그대로 표"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    assert "<a:tbl>" not in s1
    blue = [sp for sp in shapes(s1) if 'prst="roundRect"' in sp and 'val="E8F1FC"' in sp]
    pink = [sp for sp in shapes(s1) if 'prst="roundRect"' in sp and 'val="FDEEE7"' in sp]
    assert len(blue) == 3 and len(pink) == 3
    cell = dom(page, ".armx tr:nth-child(1) td:nth-child(2)")
    g = box(blue[1])
    assert near(g["x"], cell["x"], 1) and near(g["y"], cell["y"], 1) and near(g["w"], cell["w"], 1), (g, cell)
    # 같은 글자("4")가 목차 번호·다른 칸에도 있다 — 이 칸 위에 놓인 글상자를 자리로 찾는다
    ts = [box(sp) for sp in shapes(s1) if "<a:t>4</a:t>" in sp]
    t = next(b for b in ts if near(b["x"] + b["w"] / 2, cell["x"] + cell["w"] / 2, cell["w"] / 2)
             and near(b["y"] + b["h"] / 2, cell["y"] + cell["h"] / 2, cell["h"] / 2))
    assert t["x"] >= cell["x"] - 1 and t["x"] + t["w"] <= cell["x"] + cell["w"] + 1, (t, cell)
    assert "<a:tbl>" in s2 and {"머리", "칸"} <= set(texts(s2))
    ctx.close()
    assert errors == []


def has_fill(sp):
    """도형 속을 칠했는가(선 앞의 solidFill) — 선만 두른 고리는 아니다"""
    return "<a:solidFill>" in sp.split("<a:ln")[0]


def shadow_of(xml, rect):
    """rect 자리의 도형이 가진 PowerPoint 바깥 그림자 (번짐, 거리, 각 — EMU·60000분의 1도), 없으면 None"""
    for sp in shapes(xml):
        if "<a:outerShdw" in sp:
            b = box(sp)
            if near(b["x"], rect["x"], 1) and near(b["y"], rect["y"], 1) and near(b["w"], rect["w"], 1):
                return tuple(int(v) for v in re.search(r'blurRad="(\d+)" dist="(\d+)" dir="(\d+)"', sp).groups())
    return None


def second(page):
    """편집 화면을 둘째 장으로 — 둘째 장의 요소는 그 장이 보일 때 잴 수 있다"""
    page.keyboard.press("PageDown")
    page.query_selector("#frame").content_frame().wait_for_function(
        "document.querySelector('section.slide.on h2')?.textContent === '둘째 장'")


def test_box_shadow_rings_are_rings_not_discs_and_the_card_keeps_a_soft_shadow(browser, tmp_path, serve):
    """box-shadow — 번지지 않는 겹(링 아이콘)은 상자 바깥의 고리(선만)로: 속을 채우면 어두운 바탕 위에서 흰 원판이 된다. 부드러운 그림자는 PowerPoint 그림자로"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    ring = dom(page, ".ring")
    at_ring = [sp for sp in shapes(s1) if 'prst="ellipse"' in sp
               and near(box(sp)["x"] + box(sp)["w"] / 2, ring["x"] + ring["w"] / 2, 1)
               and near(box(sp)["y"] + box(sp)["h"] / 2, ring["y"] + ring["h"] / 2, 1)]
    # 바깥 7px 초록 고리(가운데선 지름 47) · 5px 흰 고리(45) · 안쪽 2px 초록 선(38 — 선 가운데가 1px 안쪽)
    assert sorted(round(box(sp)["w"]) for sp in at_ring) == [38, 45, 47], [box(sp)["w"] for sp in at_ring]
    assert not any(has_fill(sp) and 'val="FFFFFF"' in sp for sp in at_ring), "흰 고리 속이 칠해졌다(어두운 바탕을 가린다)"
    assert not any(has_fill(sp) and 'val="1BAF7A"' in sp for sp in at_ring)
    card = next(sp for sp in shapes(s1) if 'val="0B0B0B"' in sp and 'prst="roundRect"' in sp)
    assert "<a:outerShdw" in card
    ctx.close()
    assert errors == []


def test_zero_offset_outline_shadow_on_a_transparent_box_is_a_ring_around_it(browser, tmp_path, serve):
    """배경 없는 상자의 `box-shadow: 0 0 0 3px` — 상자 바깥 3px 고리뿐, 상자 속은 비어 있다(Tailwind ring)"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    second(page)
    o = dom(page, ".outl")
    rings = [sp for sp in shapes(s2) if 'val="3366CC"' in sp]
    assert len(rings) == 1 and not has_fill(rings[0]), rings
    b = box(rings[0])
    assert near(b["x"], o["x"] - 1.5, 1) and near(b["y"], o["y"] - 1.5, 1), (b, o)                 # 가운데선 = 바깥으로 1.5px
    assert near(b["w"], o["w"] + 3, 1) and near(b["h"], o["h"] + 3, 1)
    assert near(int(re.search(r'<a:ln w="(\d+)"', rings[0]).group(1)), 3 * 0.75 * 12700, 1500)     # 선 굵기 3px
    ctx.close()
    assert errors == []


def test_hard_offset_shadow_on_a_transparent_box_never_covers_its_inside(browser, tmp_path, serve):
    """배경 없는 상자의 `box-shadow: 6px 6px 0` — 오른쪽·아래 띠만, 속은 안 칠한다(검은 글 밑에 덩어리가 깔리지 않는다)"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    second(page)
    hard = dom(page, ".hard")
    reds = [box(sp) for sp in shapes(s2) if 'val="CC3333"' in sp and has_fill(sp)]
    assert len(reds) == 2, reds                                                                   # 오른쪽 띠 · 아래 띠
    for b in reds:
        overlap_x = min(b["x"] + b["w"], hard["x"] + hard["w"]) - max(b["x"], hard["x"])
        overlap_y = min(b["y"] + b["h"], hard["y"] + hard["h"]) - max(b["y"], hard["y"])
        assert not (overlap_x > 1 and overlap_y > 1), ("그림자가 상자 속을 덮었다", b, hard)
    assert near(max(b["x"] + b["w"] for b in reds), hard["x"] + hard["w"] + 6, 1)
    assert near(max(b["y"] + b["h"] for b in reds), hard["y"] + hard["h"] + 6, 1)
    ctx.close()
    assert errors == []


def test_soft_shadow_keeps_zero_offset_and_rightward_angle(browser, tmp_path, serve):
    """pptxgenjs 는 거리 0·각 0 을 '안 줌'으로 보고 4pt·위쪽(270°)으로 바꾼다 — `0 0 24px` 번짐은 거의 0 거리, `12px 0 16px` 는 오른쪽(0°)이어야"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    second(page)
    blur, dist, ang = shadow_of(s2, dom(page, ".glow"))
    assert dist < 1000 and ang != 270 * 60000, (dist, ang)                      # 4pt = 50800 EMU 가 아니다
    blur, dist, ang = shadow_of(s2, dom(page, ".side"))
    assert ang in (0, 359 * 60000), ang                                         # 위(270°)가 아니라 오른쪽
    assert near(dist, 12 * 0.75 * 12700, 12 * 0.75 * 12700 * 0.1), dist
    ctx.close()
    assert errors == []


def test_range_slider_is_drawn_as_track_fill_and_thumb(browser, tmp_path, serve):
    """input[type=range] — 입력 칸의 흰 바탕 상자가 아니라 홈·채운 부분·손잡이 도형(글 칸 안에 있어도)"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    r = dom(page, ".rng input")
    thumbs = [box(sp) for sp in shapes(s1) if 'prst="ellipse"' in sp and 'val="1BAF7A"' in sp
              and near(box(sp)["w"], 16, 0.5)]
    assert thumbs, "손잡이가 없다"
    t = thumbs[0]
    assert near(t["y"] + t["h"] / 2, r["y"] + r["h"] / 2, 1.5)
    assert near(t["x"] + t["w"] / 2, r["x"] + 8 + 0.5 * (r["w"] - 16), 1.5)      # 값 3 / 0~6 — 가운데
    assert not any('val="FFFFFF"' in sp and near(box(sp)["w"], r["w"], 1) and near(box(sp)["h"], r["h"], 1)
                   for sp in shapes(s1)), "입력 칸의 흰 바탕이 그려졌다"
    ctx.close()
    assert errors == []


def test_custom_styled_and_rtl_sliders(browser, tmp_path, serve):
    """appearance:none 으로 덱이 제 모양을 입힌 슬라이더는 그 배경(일반 상자)으로 — 기본 모양(회색 홈·파란 채움)으로 덮어쓰지 않는다.
    dir=rtl 슬라이더는 값이 오른쪽에서부터 찬다"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    second(page)
    c = dom(page, ".cs input")
    bar = [box(sp) for sp in shapes(s2) if 'prst="roundRect"' in sp and 'val="333333"' in sp]
    assert len(bar) == 1 and near(bar[0]["w"], c["w"], 1) and near(bar[0]["h"], c["h"], 1), (bar, c)
    assert not any('val="EFEFEF"' in sp and near(box(sp)["y"] + box(sp)["h"] / 2, c["y"] + c["h"] / 2, 3)
                   for sp in shapes(s2)), "기본 모양의 홈이 얹혔다"
    r = dom(page, ".rtl input")
    thumb = next(box(sp) for sp in shapes(s2) if 'prst="ellipse"' in sp and 'val="1BAF7A"' in sp
                 and near(box(sp)["w"], 16, 0.5) and near(box(sp)["y"] + box(sp)["h"] / 2, r["y"] + r["h"] / 2, 2))
    assert near(thumb["x"] + thumb["w"] / 2, r["x"] + 8 + 0.75 * (r["w"] - 16), 1.5), (thumb, r)     # 값 1 / 0~4, 오른쪽에서 4분의 1
    ctx.close()
    assert errors == []


def test_wrapped_inline_paragraph_stays_one_text_box(browser, tmp_path, serve):
    """줄 앞에 인라인 그림이 있어 첫 글이 아래로 밀린, 여러 줄로 꺾이는 문단 — 글 조각마다 나눠 겹쳐 그리지 않고 글상자 하나로"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    boxes =[sp for sp in shapes(s2) if "위성영상" in "".join(re.findall(r"<a:t>([^<]*)</a:t>", sp))]
    assert len(boxes) == 1, len(boxes)
    whole = "".join(re.findall(r"<a:t>([^<]*)</a:t>", boxes[0]))
    assert "공개출처" in whole and whole.rstrip().endswith("거슬러 확인한다"), whole
    assert 360 <= box(boxes[0])["w"] <= 380, box(boxes[0])                    # 문단 폭 그대로(여러 줄 글상자는 3% 넓힌다) — 글 조각 폭이 아니다
    ctx.close()
    assert errors == []


def test_display_contents_child_keeps_its_text(browser, tmp_path, serve):
    """display:contents 인 자식은 자기 상자가 없다 — 칸 사이가 벌어진 flex 열에서도 그 안의 글이 빠지지 않는다"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    t = texts(s2)
    assert "바깥 글" in t and "첫째 안쪽" in t and "둘째 안쪽" in t, t
    ctx.close()
    assert errors == []


def test_only_corner_rounded_table_stays_a_powerpoint_table(browser, tmp_path, serve):
    """표 바깥 모서리 칸 하나만 둥근 보통 표는 PowerPoint 표로(편집할 수 있게) — 칸마다 도형으로 쪼개지 않는다"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    assert s2.count("<a:tbl>") == 2 and {"가", "나", "다"} <= set(texts(s2))
    ctx.close()
    assert errors == []


def test_script_made_page_number_is_exported_without_touching_the_deck(browser, tmp_path, serve):
    """덱 스크립트가 쪽마다 만드는 쪽 번호(.pg) — 편집 화면은 스크립트를 돌리지 않아도 PPTX 에는 장 번호가 든다. 편집 화면의 덱은 그대로"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    for xml, t in ((s1, "1"), (s2, "2")):                  # 첫 장의 "1" 은 목차 번호에도 있다 — 오른쪽 아래 모서리의 것을 찾는다
        n = corner_number(xml, t)
        assert n, (t, "쪽 번호가 없다")
        assert near(n["x"] + n["w"], 1280 - 28, 2) and n["y"] + n["h"] > 720 - 14 - 20     # 오른쪽 28px·아래 14px 둘레
    assert page.query_selector("#frame").content_frame().evaluate("document.querySelectorAll('.pg').length") == 0
    ctx.close()
    assert errors == []


def test_no_page_number_when_the_deck_does_not_make_one(browser, tmp_path, serve):
    """스타일시트에 .pg 규칙만 있고 덱 스크립트가 그 이름을 쓰지 않으면 번호를 만들어 넣지 않는다"""
    deck = FID.replace("pg.className='pg'; ", "pg.className='x'; ")
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve, deck)
    assert corner_number(s1, "1") is None and corner_number(s2, "2") is None
    ctx.close()
    assert errors == []


LINES = """(sel) => { const e = document.querySelector('section.slide.on ' + sel); const n = e.firstChild; const rg = document.createRange();
  const out = []; let top = null; let cur = '';
  for (let i = 0; i < n.data.length; i += 1) {
    rg.setStart(n, i); rg.setEnd(n, i + 1); const r = rg.getClientRects()[0];
    if (!r) continue;
    if (top !== null && r.top > top + 0.6 * r.height) { out.push(cur.trim()); cur = ''; }
    if (top === null || r.top > top + 0.6 * r.height) top = r.top;
    cur += n.data[i];
  }
  out.push(cur.trim()); return out; }"""


def test_balanced_heading_breaks_where_the_browser_broke_it(browser, tmp_path, serve):
    """text-wrap: balance — 브라우저는 줄 길이를 고르게 꺾고 PowerPoint 는 꽉 채워 꺾는다. 화면의 줄 시작마다 줄바꿈을 넣어 같은 자리에서 꺾인다"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    second(page)
    want = page.query_selector("#frame").content_frame().evaluate(LINES, ".bal")
    assert len(want) == 2, want                                                    # 화면은 두 줄
    sp = with_text(s2, want[0] + " ") if f"<a:t>{want[0]} </a:t>" in "".join(shapes(s2)) else with_text(s2, want[0])
    assert sp.count("<a:br") == 1, sp.count("<a:br")
    got = re.findall(r"<a:t>([^<]*)</a:t>", sp)
    assert [g.strip() for g in got] == want, (got, want)
    ctx.close()
    assert errors == []


def test_no_stray_page_number_when_the_deck_rule_only_applies_inside_another_box(browser, tmp_path, serve):
    """`.foot .pg` 처럼 다른 칸 안에서만 먹는 규칙이면 장에 바로 단 번호는 스타일이 없다 — 왼쪽 위에 얹힌 번호를 만들지 않는다"""
    deck = FID.replace(".pg{position:absolute;right:28px", ".foot .pg{position:absolute;right:28px")
    assert ".foot .pg{" in deck
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve, deck)
    assert corner_number(s2, "2") is None
    assert all(box(sp)["y"] > 300 for sp in shapes(s2) if "<a:t>2</a:t>" in sp)       # 둘째 장의 "2" 는 표 칸뿐
    ctx.close()
    assert errors == []


def test_text_is_shifted_by_the_measured_powerpoint_line_offsets(browser, tmp_path, serve):
    """PowerPoint 는 줄 안의 글자를 CSS 보다 위에 놓는다(맑은 고딕 실측) — 한 줄은 글자 크기의 0.07배, 정확한 줄 간격(spcPts)을 준 글은
    0.24·(1.62 − 줄 높이/글자 크기)배만큼 상자를 아래로 옮겨 맞춘다"""
    ctx, page, errors, (s1, s2) = export(browser, tmp_path, serve)
    h = dom(page, "h2")
    g = box(with_text(s1, "충실도 시험"))
    assert near(g["y"], h["y"] + 0.07 * 40, 0.6), (g, h)                                   # 40px 한 줄 제목
    p = dom(page, ".two")
    sp = with_text(s1, "두 줄로 꺾이는 문단입니다 두 줄로 꺾이는 문단")
    g = box(sp)
    assert near(g["y"], p["y"] + 0.24 * (1.62 - 1.2) * 24, 0.6), (g, p)                    # 24px · 줄 높이 1.2 두 줄
    ctx.close()
    assert errors == []
