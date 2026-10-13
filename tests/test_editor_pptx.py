"""덱 편집기 — PPTX 받기: 지금 편집한 덱을 PowerPoint 파일로. 받은 파일을 풀어 슬라이드 XML 을 본다(Playwright)."""
import re
import struct
import xml.etree.ElementTree as ET
import zipfile
import zlib
from urllib.parse import quote

from playwright.sync_api import expect

from test_editor import (  # noqa: F401 — browser·serve·local_edit 는 fixture
    BUILDER, FLOW, QUIET, DeckHub, browser, local_edit, make_site, open_editor, select_text, serve, state,
)
from test_editor_arrange import arr, click_box, open_arr  # noqa: F401 — arr 는 fixture

TITLE = "section.slide:nth-of-type(1) [data-name=title] .tin"


def png(w: int, h: int, rgb=(200, 30, 30)) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def take(page, tmp_path, name: str = "deck.pptx"):
    """‘PPTX 받기’를 눌러 받은 파일 → (받은 이름, zip)"""
    with page.expect_download(timeout=90000) as d:
        page.click("#pptx")
    path = tmp_path / name
    d.value.save_as(path)
    return d.value.suggested_filename, zipfile.ZipFile(path)


def slides(z: zipfile.ZipFile) -> list[str]:
    names = [n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
    names.sort(key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)))
    return [z.read(n).decode("utf-8") for n in names]


def notes(z: zipfile.ZipFile, k: int) -> str:
    return z.read(f"ppt/notesSlides/notesSlide{k}.xml").decode("utf-8")


def texts(xml: str) -> list[str]:
    return re.findall(r"<a:t>([^<]*)</a:t>", xml)


def clean(xml: str) -> bool:
    """올바른 XML 이고, 문단마다 a:pPr 는 맨 앞에 하나까지(다듬기), 중국어 문자 집합 표시·빈 선이 없다."""
    ET.fromstring(xml)
    for body in re.findall(r"<a:p>(.*?)</a:p>", xml, re.S):
        n = body.count("<a:pPr")
        if n > 1 or (n == 1 and not body.startswith("<a:pPr")):
            return False
    return 'charset="-122"' not in xml and "<a:ln></a:ln>" not in xml


# 표의 첫 칸 왼쪽 끝 ~ 끝 칸 오른쪽 끝(px) — 겹친 바깥 테두리의 반쪽은 표 상자에만 든다
SPAN = """(sel) => { const c = document.getElementById('frame').contentDocument.querySelector(sel).rows[0].cells;
  return c[c.length - 1].getBoundingClientRect().right - c[0].getBoundingClientRect().left; }"""


def shapes(xml: str) -> list[str]:
    return re.findall(r"<p:sp>.*?</p:sp>", xml, re.S)


def test_pptx_keeps_text_tables_pictures_and_notes(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"builder.html": BUILDER})
    base = serve(site)
    hub = DeckHub({"decks/builder.html": (root / "decks" / "builder.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    select_text(page, TITLE, "시험 덱 표지")
    page.keyboard.type("고친 표지")                     # 저장하지 않은 고침도 들어간다
    page.keyboard.press("Escape")
    page.keyboard.press("PageDown")                     # 둘째 장을 보던 중 — 받은 뒤에도 그 장
    assert state(page)["cur"] == 1
    name, z = take(page, tmp_path)
    assert name == "builder_편집본.pptx"
    expect(page.locator("#status")).to_contain_text("PPTX 로 받았습니다 — 3장")
    status = page.inner_text("#status")
    assert "도표(SVG) 1개" in status and "Malgun Gothic" in status and "옮기지 못한" not in status
    assert state(page)["cur"] == 1 and not page.locator("#pxDlg").is_visible()
    pres = z.read("ppt/presentation.xml").decode("utf-8")
    assert 'cx="12192000"' in pres and 'cy="6858000"' in pres          # 1280×720 = 13.333×7.5 in
    s1, s2, s3 = slides(z)
    assert all(clean(x) for x in (s1, s2, s3))
    # 1장: 장 바탕색, 고친 제목 — 52px = 39pt, 흰 글, 일반 글꼴(sans-serif)은 맑은 고딕, 한국어
    assert '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="10213F"/>' in s1
    assert texts(s1) == ["고친 표지"]
    run = re.search(r'<a:rPr [^>]*sz="3900"[^>]*>(?:(?!</a:rPr>).)*</a:rPr><a:t>고친 표지', s1, re.S)
    assert run and 'val="FFFFFF"' in run.group(0) and 'typeface="Malgun Gothic"' in run.group(0)
    assert 'lang="ko-KR"' in run.group(0)
    assert 'wrap="none"' in s1 and 'txBox="1"' in s1                # 한 줄짜리 글은 줄을 바꾸지 않는 글상자
    # 2장: 두 문단이 한 글상자에(줄 간격 31.2px = 23.4pt), 도표(SVG)는 그림
    assert texts(s2) == ["1. 서론", "둘째 장 제목", "첫 문단", "둘째 문단", "2 / 3"]
    body = next(sp for sp in shapes(s2) if "첫 문단" in sp)
    assert body.count("<a:p>") == 2 and body.count('<a:spcPts val="2340"/>') == 2
    assert s2.count("<p:pic>") == 1
    # 3장: 표(두 칸)
    assert "<a:tbl>" in s3 and s3.count("<a:gridCol ") == 2
    assert [t for t in texts(s3) if t.startswith("칸")] == ["칸 하나", "칸 둘"]
    media = [n for n in z.namelist() if n.startswith("ppt/media/") and not n.endswith("/")]
    assert len(media) == 1 and media[0].endswith(".png")
    # 노트(글 그대로 — 꺾쇠는 글자로)
    assert "첫 장 노트" in notes(z, 1) and "둘째 장 노트 &lt;b&gt;" in notes(z, 2) and "셋째 장 노트" in notes(z, 3)
    ctx.close()
    assert errors == []


def test_pptx_from_a_flow_deck_keeps_runs_lists_and_links(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"flow.html": FLOW})
    base = serve(site)
    hub = DeckHub({"decks/flow.html": (root / "decks" / "flow.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    name, z = take(page, tmp_path)
    assert name == "flow_편집본.pptx"
    s1, s2, s3 = slides(z)
    assert all(clean(x) for x in (s1, s2, s3))
    assert '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0E1A2B"/>' in s1     # 어두운 장
    t1 = texts(s1)
    assert "흐름 덱 표지" in t1 and ["부제 ", "굵게", " 끝"] == t1[t1.index("부제 "):t1.index("부제 ") + 3]
    bold = re.search(r'<a:rPr [^>]*b="1"[^>]*>(?:(?!</a:rPr>).)*</a:rPr><a:t>굵게</a:t>', s1, re.S)
    assert bold and 'val="FFFFFF"' in bold.group(0)                         # 어두운 장의 흰 글
    # 목록 — 항목마다 문단, 글머리표
    lst = next(sp for sp in shapes(s2) if "하나" in sp)
    assert lst.count("<a:p>") == 2 and lst.count('<a:buChar char="&#x2022;"/>') == 2
    # 링크
    rels = z.read("ppt/slides/_rels/slide2.xml.rels").decode("utf-8")
    assert "hlinkClick" in s2 and "https://example.com/" in rels
    assert "<a:tbl>" in s3 and {"머리", "칸"} <= set(texts(s3))
    assert "첫 장 노트" in notes(z, 1) and "둘째 노트" in notes(z, 2) and "셋째 노트" in notes(z, 3)
    ctx.close()
    assert errors == []


RICH = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>꾸밈 시험 덱</title>
<style>
body{margin:0;font-family:"Malgun Gothic",sans-serif}
.deck{position:relative;width:1280px;height:720px}
.slide{position:absolute;inset:0;display:none;background:#FFFFFF}
.slide.on{display:block}
.card{position:absolute;left:40px;top:40px;width:300px;height:120px;background:#E8F0FE;border-radius:12px;padding:16px;
  box-sizing:border-box;font-size:20px;color:#123456;margin:0}
.bar{position:absolute;left:400px;top:40px;width:300px;height:120px;border-left:6px solid #DD0000;padding-left:12px;
  font-size:20px;margin:0;box-sizing:border-box}
.grad{position:absolute;left:760px;top:40px;width:200px;height:120px;background:linear-gradient(90deg,#FF0000,#0000FF)}
.rot{position:absolute;left:1000px;top:60px;width:160px;height:60px;transform:rotate(15deg);background:#00AA00;color:#FFFFFF;
  font-size:18px;margin:0}
.badge{background:#FFD400;border-radius:4px;padding:0 4px}
.lines{position:absolute;left:40px;top:200px;width:500px;font-size:24px;line-height:32px;margin:0}
ul.dash{position:absolute;left:600px;top:200px;width:400px;list-style:none;padding-left:24px;margin:0;font-size:20px}
ul.dash li{position:relative}
ul.dash li::before{content:"–";position:absolute;left:-20px}
ol.num{position:absolute;left:600px;top:320px;width:400px;font-size:20px;margin:0;padding-left:32px}
table.t{position:absolute;left:40px;top:420px;border-collapse:collapse;font-size:16px}
table.t td,table.t th{border:1px solid #333333;padding:4px 8px}
table.t th{background:#EEEEEE}
.pic{position:absolute;left:1000px;top:420px;width:200px;height:100px;object-fit:cover}
</style></head><body><div class="deck">
<section class="slide on" data-notes="꾸밈 노트">
<p class="card">카드 <span class="badge">새</span> 글</p>
<p class="bar">왼쪽 선</p>
<div class="grad"></div>
<p class="rot">돌린 상자</p>
<p class="lines">첫 줄<br>둘째 줄 x<sup>2</sup></p>
<ul class="dash"><li>가</li><li>나</li></ul>
<ol class="num" start="3"><li>셋</li><li>넷</li></ol>
<table class="t"><tr><th colspan="2">머리</th></tr><tr><td rowspan="2">왼</td><td>오1</td></tr><tr><td>오2</td></tr></table>
<img class="pic" src="pic.png" alt="">
</section>
</div></body></html>
"""


def test_pptx_moves_boxes_lists_tables_and_pictures(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"rich.html": RICH})
    (site / "decks" / "pic.png").write_bytes(png(4, 4))
    base = serve(site)
    hub = DeckHub({"decks/rich.html": (root / "decks" / "rich.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "rich", hub)
    name, z = take(page, tmp_path)
    expect(page.locator("#status")).to_contain_text("그라데이션·배경 그림 1개")
    (s1,) = slides(z)
    assert clean(s1)
    sps = shapes(s1)
    # 둥근 모서리 상자: 12px / 짧은 변 120px = 10%
    card = next(sp for sp in sps if 'val="E8F0FE"' in sp)
    assert 'prst="roundRect"' in card and 'fmla="val 10000"' in card
    # 배경만 칠한 글 줄(형광 띠)은 도형이 아니라 글자 형광으로 — 글과 함께 움직인다. 안쪽 여백은 빈칸으로.
    assert not any('val="FFD400"' in sp for sp in sps if "<a:t>" not in sp)
    hl = re.search(r'<a:rPr [^>]*>(?:(?!</a:rPr>).)*</a:rPr><a:t>새</a:t>', s1, re.S)
    assert hl and '<a:highlight><a:srgbClr val="FFD400"/></a:highlight>' in hl.group(0)
    assert texts(s1)[:4] == ["카드 ", "새", " ", "글"]
    # 왼쪽 선만 있는 상자 → 가는 도형(6px = 0.0625in = 57150 EMU)
    assert any('val="DD0000"' in sp and 'cx="57150"' in sp for sp in sps)
    # 돌린 상자 — 도형과 글상자 모두 15도
    assert sum('rot="900000"' in sp for sp in sps) == 2
    # <br> 은 같은 문단의 줄바꿈, 위첨자
    lines = next(sp for sp in sps if "첫 줄" in sp)
    assert lines.count("<a:p>") == 1 and "<a:br/>" in lines
    assert re.search(r'<a:rPr [^>]*baseline="30000"[^>]*>(?:(?!</a:rPr>).)*</a:rPr><a:t>2</a:t>', lines, re.S)
    # ::before 로 그린 표시는 그 글자의 글머리표, 번호 목록은 시작 번호대로
    dash = next(sp for sp in sps if "<a:t>가</a:t>" in sp)
    assert dash.count('<a:buChar char="&#x2013;"/>') == 2
    num = next(sp for sp in sps if "<a:t>셋</a:t>" in sp)          # 시작 번호는 첫 항목에만(이어 센다)
    assert num.count('<a:buAutoNum type="arabicPeriod" startAt="3"/>') == 1
    assert num.count('<a:buAutoNum type="arabicPeriod"/>') == 1 and 'startAt="0"' not in s1
    # 표 — 합친 칸, 머리 칸 색, 1px 테두리(0.75pt = 9525 EMU)
    tbl = re.search(r"<a:tbl>.*?</a:tbl>", s1, re.S).group(0)
    assert tbl.count("<a:gridCol ") == 2 and 'gridSpan="2"' in tbl and 'rowSpan="2"' in tbl
    assert 'val="EEEEEE"' in tbl and '<a:lnT w="9525"' in tbl
    assert [t for t in texts(tbl)] == ["머리", "왼", "오1", "오2"]
    # 그림 — 그라데이션은 그린 그림으로, PNG 는 원본 그대로 잘라 채우기(object-fit: cover)
    assert s1.count("<p:pic>") == 2 and "<a:srcRect" in s1
    media = sorted(n for n in z.namelist() if n.startswith("ppt/media/") and not n.endswith("/"))
    assert len(media) == 2 and png(4, 4) in [z.read(n) for n in media]
    assert "꾸밈 노트" in notes(z, 1)
    ctx.close()
    assert errors == []


ROWS = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>배치 시험 덱</title>
<style>
body{margin:0;font-family:"Malgun Gothic",sans-serif}
.deck{position:relative;width:1280px;height:720px}
.slide{position:absolute;inset:0;display:none;background:#FFFFFF}
.slide.on{display:block}
.slide::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:#0055AA}
.foot{position:absolute;left:40px;right:40px;bottom:20px;display:flex;justify-content:space-between;font-size:14px;margin:0}
.pp{position:absolute;left:40px;top:40px;width:500px;margin:0;font-size:20px}
.pp p{position:relative;padding-left:20px;margin:0 0 8px}
.pp .bu{position:absolute;left:0;top:0;width:16px}
.n{position:absolute;left:600px;top:40px;display:inline-grid;place-items:center;width:40px;height:40px;border-radius:50%;
  background:#223344;color:#FFFFFF;font-size:20px;margin:0;line-height:28px}
.chev{position:absolute;left:700px;top:40px;width:200px;height:60px;margin:0;font-size:18px}
.chev::after{content:"";position:absolute;right:-30px;top:50%;width:20px;height:20px;margin-top:-10px;
  border-top:4px solid #CC0000;border-right:4px solid #CC0000;transform:rotate(45deg)}
.ev{position:absolute;left:40px;top:200px;width:600px;margin:0;font-size:16px}
.ev b{margin-right:6px}
.eq{position:absolute;left:700px;top:200px;margin:0;font-size:24px}
.eq .up{font-size:.62em;vertical-align:.55em}
table.t{position:absolute;left:40px;top:300px;border-collapse:collapse;font-size:16px}
table.t td{border:1px solid #333333;padding:4px 8px;white-space:nowrap}
.badge{display:inline-block;padding:.1em .6em;border-radius:999px;background:#4F86BE;color:#FFFFFF}
.live{position:absolute;left:700px;top:300px;display:inline-flex;align-items:center;gap:6px;font-size:16px;margin:0}
.live::before{content:"";width:8px;height:8px;border-radius:50%;background:#00AA00}
ul.mix{position:absolute;left:40px;top:420px;width:500px;margin:0;padding-left:30px;font-size:18px}
ul.mix li.plain{list-style:none}
</style></head><body><div class="deck">
<section class="slide on">
<div class="pp"><p><span class="bu">√</span>첫 항목 글</p><p><span class="bu">√</span>둘째 항목 글</p></div>
<p class="n">3</p>
<p class="chev">꺾쇠 앞 상자</p>
<p class="ev"><b>E141</b>2023-02-08 열병식</p>
<p class="eq">D<span class="up">2</span></p>
<table class="t"><tr><td>단계</td><td><span class="badge">S3</span></td></tr></table>
<p class="live">실시간</p>
<ul class="mix"><li>점 있는 항목</li><li class="plain">점 없는 항목</li></ul>
<p class="foot"><span>서론 Ⅰ장</span><span>4 / 29</span></p>
</section>
</div></body></html>
"""


def test_pptx_keeps_rows_marks_badges_and_decorations(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"rows.html": ROWS})
    base = serve(site)
    hub = DeckHub({"decks/rows.html": (root / "decks" / "rows.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "rows", hub)
    width = page.evaluate(SPAN, "table.t")
    name, z = take(page, tmp_path)
    (s1,) = slides(z)
    assert clean(s1)
    sps = shapes(s1)
    box = lambda t: next(sp for sp in sps if f"<a:t>{t}</a:t>" in sp)  # noqa: E731
    x = lambda sp: int(re.search(r'<a:off x="(\d+)"', sp).group(1))  # noqa: E731
    # 한 줄에 나란히 놓인 flex 칸(꼬리말)은 칸마다 제 자리의 글상자로 — 쪽 번호가 오른쪽에 따로
    foot, page_no = box("서론 Ⅰ장"), box("4 / 29")
    assert foot != page_no and x(page_no) > 9000000
    # 왼쪽 여백에 절대 자리로 둔 글자(√)는 그 문단의 글머리표 — 글로 남지 않고, 여백(20px = 15pt)만큼 매단다
    first = box("첫 항목 글")
    assert '<a:buChar char="&#x221A;"/>' in first and 'marL="190500" indent="-190500"' in first and 'lIns="0"' in first
    assert "√" not in "".join(texts(s1))
    # 가운데 둔 번호(inline-grid)는 가운데 정렬·가운데 맞춤, 정한 줄 간격 없이
    n = box("3")
    assert 'algn="ctr"' in n and 'anchor="ctr"' in n and "<a:lnSpc>" not in n
    # 글 줄의 옆 여백(6px)은 빈칸으로, 수치로 올린 작은 글자는 위첨자(부모 글자 크기 24px = 18pt)
    assert texts(box("E141"))[:3] == ["E141", " ", "2023-02-08 열병식"]
    sup = re.search(r'<a:rPr [^>]*baseline="30000"[^>]*>(?:(?!</a:rPr>).)*</a:rPr><a:t>2</a:t>', box("D"), re.S)
    assert sup and 'sz="1800"' in sup.group(0)
    # 표 칸 안의 배지는 형광으로, 표 폭은 화면 그대로(옆 상자·여백을 넘지 않게)
    tbl = re.search(r"<a:tbl>.*?</a:tbl>", s1, re.S).group(0)
    assert '<a:highlight><a:srgbClr val="4F86BE"/></a:highlight>' in tbl
    grid = sum(int(w) for w in re.findall(r'<a:gridCol w="(\d+)"', tbl))
    assert abs(grid - width * 9525) <= width * 9525 * 0.005
    # 꾸밈 상자 — 장의 왼쪽 띠(절대 자리, 5px), 돌린 꺾쇠(두 변 테두리 → 그림, 45도), flex 줄 앞의 점(동그라미)
    assert any('val="0055AA"' in sp and 'cx="47640"' in sp for sp in sps)
    pics = re.findall(r"<p:pic>.*?</p:pic>", s1, re.S)
    assert len(pics) == 1 and 'rot="2700000"' in pics[0]
    dot = next(sp for sp in sps if 'val="00AA00"' in sp)
    live = box("실시간")
    assert 'prst="ellipse"' in dot and x(dot) == x(live) and 'lIns="133350"' in live   # 점 8px + 사이 6px 뒤에서 글
    # 목록 — 점 있는 항목은 글머리표, 점 없는 항목도 같은 여백(30px = 22.5pt)에 글머리표 없이
    lst = box("점 있는 항목")
    assert '<a:pPr algn="l" marL="285750" indent="-285750"><a:buSzPct val="100000"/><a:buChar char="&#x2022;"/>' in lst
    assert '<a:pPr algn="l" marL="285750" indent="0"><a:buNone/></a:pPr>' in lst and "200B" not in s1
    ctx.close()
    assert errors == []


CHIPS = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>칩 시험 덱</title>
<style>
@font-face{font-family:"WebFam";src:local("Arial")}
body{margin:0;font-family:"Malgun Gothic",sans-serif}
.deck{position:relative;width:1280px;height:720px}
.slide{position:absolute;inset:0;display:none;background:#FFFFFF}
.slide.on{display:block}
.cmd{position:absolute;left:40px;top:40px;width:900px;margin:0;font-size:20px}
.chip{background:#EEEEFF;border:1px solid #CCCCDD;border-radius:4px;padding:0 4px;white-space:nowrap}
.kpi{position:absolute;left:40px;top:120px;width:200px;margin:0;font-size:44px;line-height:1}
.kpi-l{position:absolute;left:40px;top:166px;width:200px;margin:0;font-size:14px;line-height:1.6}
.pp{position:absolute;left:300px;top:120px;width:500px;margin:0;font-size:20px;color:#12202A}
.pp p{position:relative;padding-left:20px;margin:0}
.pp .bu{position:absolute;left:0;top:0;color:#44525E}
table.w{position:absolute;left:40px;top:300px;width:400px;border-collapse:collapse;font-size:16px}
table.w td{border:1px solid #333333;padding:4px 8px}
.web{position:absolute;left:40px;top:500px;margin:0;font-family:"WebFam","Malgun Gothic",sans-serif;font-size:20px}
</style></head><body><div class="deck">
<section class="slide on">
<p class="cmd">명령 <code class="chip">slides</code>) 다음 <code class="chip">Commit changes</code>, <code class="chip">my-talk.html</code>, ▶ 발표</p>
<p class="kpi">93%</p>
<p class="kpi-l">달성률</p>
<div class="pp"><p><span class="bu">√</span>첫 항목</p></div>
<table class="w"><tr><td>여러 줄로 꺾이는 긴 설명 글 칸 여러 줄로 꺾이는 긴 설명 글 칸</td><td>−3,456.78</td></tr></table>
<p class="web">웹 글꼴 글</p>
</section>
</div></body></html>
"""


def test_pptx_keeps_chips_kpis_bullet_colours_and_columns(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"chips.html": CHIPS})
    base = serve(site)
    hub = DeckHub({"decks/chips.html": (root / "decks" / "chips.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "chips", hub)
    tw = page.evaluate(SPAN, "table.w")
    cw = page.evaluate("document.getElementById('frame').contentDocument.querySelector('table.w td + td').getBoundingClientRect().width")
    name, z = take(page, tmp_path)
    # 웹 글꼴(@font-face)은 그 글꼴을 깐 PC 에서만 같은 글꼴 — 받은 뒤 따로 알린다
    expect(page.locator("#status")).to_contain_text("웹 글꼴(WebFam)")
    (s1,) = slides(z)
    assert clean(s1)
    sps = shapes(s1)
    box = lambda t: next(sp for sp in sps if f"<a:t>{t}</a:t>" in sp)  # noqa: E731
    # 가는 테두리의 코드 칩은 도형이 아니라 형광으로, 칩 뒤의 닫는 괄호·쉼표 앞에는 빈칸을 두지 않고, 줄을 바꾸지 않는 칩 안의
    # 빈칸·붙임표는 꺾이지 않는 빈칸(NBSP)·붙임표(U+2011)로, ▶ 는 글자꼴 선택자(FE0E)를 붙여 기호 글꼴의 따로 된 조각으로
    nb, nh, vs = chr(0xA0), chr(0x2011), chr(0xFE0E)
    cmd = box("slides")
    assert texts(cmd) == ["명령 ", "slides", ") 다음 ", f"Commit{nb}changes", ", ", f"my{nh}talk.html", ", ", f"▶{vs}", " 발표"]
    assert cmd.count('<a:highlight><a:srgbClr val="EEEEFF"/></a:highlight>') == 3
    run = lambda t: re.search(rf'<a:rPr [^>]*>(?:(?!</a:rPr>).)*</a:rPr><a:t>{t}</a:t>', cmd, re.S).group(0)  # noqa: E731
    assert 'typeface="Segoe UI Symbol"' in run(f"▶{vs}") and 'typeface="Malgun Gothic"' in run(" 발표")
    assert not any('val="EEEEFF"' in sp for sp in sps if "<a:t>" not in sp)
    # 한 줄짜리 KPI 값과 이름은 줄 간격 없이 위아래 가운데(CSS 의 줄 가운데 글자)
    for t in ("93%", "달성률"):
        assert 'anchor="ctr"' in box(t) and "<a:lnSpc>" not in box(t)
    # 따로 둔 표시(√)의 색이 글과 다르면 글머리표 색(buClr) — 언어 표시는 그대로
    first = box("첫 항목")
    assert '<a:buClr><a:srgbClr val="44525E"/></a:buClr><a:buSzPct val="100000"/><a:buChar char="&#x221A;"/>' in first
    assert "-x-bu" not in s1 and 'lang="ko-KR"' in first
    # 표 폭은 그대로, 한 줄에 든 숫자 열은 글 폭에 여유를 두게 꺾이는 글 열에서 폭을 덜어 온다
    g0, g1 = (int(w) for w in re.findall(r'<a:gridCol w="(\d+)"', s1))
    assert abs(g0 + g1 - tw * 9525) <= tw * 9525 * 0.005 and g1 > cw * 9525 * 1.02
    assert 'typeface="WebFam"' in box("웹 글꼴 글")
    ctx.close()
    assert errors == []


FIT = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>열 폭 시험 덱</title>
<style>
@font-face{font-family:"WebFam";src:local("Arial")}
body{margin:0;font-family:"Malgun Gothic",sans-serif}
.deck{position:relative;width:1280px;height:720px}
.slide{position:absolute;inset:0;display:none;background:#FFFFFF}
.slide.on{display:block}
table.g{position:absolute;left:40px;top:40px;width:640px;border-collapse:collapse;font-size:16px}
table.g td{border:1px solid #333333;padding:4px 8px;vertical-align:top}
table.g td:first-child{width:110px}
table.g p{margin:0}
table.n{position:absolute;left:40px;top:400px;border-collapse:collapse;font-size:16px;font-family:"WebFam",sans-serif}
table.n td{border:1px solid #333333;padding:2px 6px;white-space:nowrap}
</style></head><body><div class="deck">
<section class="slide on">
<table class="g"><tr><td><p>GDELT 주제</p><p>표지</p></td>
<td><p>여러 줄로 꺾이는 긴 설명 글 칸 여러 줄로 꺾이는 긴 설명 글 칸 여러 줄로 꺾이는 긴 설명 글</p></td><td>3,456</td></tr></table>
<table class="n"><tr><td>북핵 위협·미국 불확실성</td><td>1.00</td></tr></table>
</section>
</div></body></html>
"""


def test_pptx_fits_columns_by_lines_and_shrinks_tight_tables(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"fit.html": FIT})
    base = serve(site)
    hub = DeckHub({"decks/fit.html": (root / "decks" / "fit.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "fit", hub)
    m = page.evaluate("""() => { const d = document.getElementById('frame').contentDocument;
      const tds = [...d.querySelectorAll('table.g td')];
      const r = d.createRange();
      r.selectNodeContents(tds[0].querySelector('p').firstChild);
      return { cols: tds.map((td) => td.getBoundingClientRect().width), line: r.getClientRects().length,
        width: r.getBoundingClientRect().width }; }""")
    assert m["line"] == 1                     # 화면에서 첫 문단은 한 줄
    name, z = take(page, tmp_path)
    expect(page.locator("#status")).to_contain_text("표 1개는 PowerPoint 글꼴로 넓어진 글이 꺾이지 않게 글자를 조금")
    (s1,) = slides(z)
    assert clean(s1)
    g, n = re.findall(r"<a:tbl>.*?</a:tbl>", s1, re.S)
    g0, g1, g2 = (int(w) for w in re.findall(r'<a:gridCol w="(\d+)"', g))
    # 두 문단(제목·부제)이 저마다 한 줄인 칸은 꺾인 칸이 아니라 그 줄이 들어갈 폭(안쪽 여백 16px 까지) 아래로는 내주지 않고,
    # 한 문단이 여러 줄로 꺾이는 칸의 열이 내주며, 한 줄에 든 숫자 열은 받는다
    assert g0 >= (m["width"] + 16) * 9525 and g1 <= m["cols"][1] * 9525 and g2 >= m["cols"][2] * 9525
    # 모든 열이 글에 꼭 맞는 줄바꿈 없는 표는 나눌 폭이 없어 글자를 조금(0.85 배까지) 줄이고, 표 칸 전체에 건 nowrap 의
    # 빈칸은 그대로 둔다(PowerPoint 가 꺾어야 하면 낱말 가운데가 아니라 빈칸에서)
    (big,) = {int(v) for v in re.findall(r'sz="(\d+)"', g)}
    small = {int(v) for v in re.findall(r'sz="(\d+)"', n)}
    assert small and all(big * 0.85 - 1 <= v < big for v in small)
    assert "북핵 위협·미국 불확실성" in texts(n)
    ctx.close()
    assert errors == []


def test_pptx_under_slides_edit_keeps_the_picture_bytes(browser, tmp_path, local_edit):
    e = local_edit
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda x: errors.append(str(x)))
    page.on("console", lambda m: errors.append(m.text)
            if m.type == "error" and not any(q in m.text for q in QUIET) else None)
    page.goto(e.url)
    page.wait_for_selector("#app.ready", timeout=60000)
    name, z = take(page, tmp_path)                     # 이 PC 의 편집기 서버도 PPTX 도구(vendor)를 내준다
    assert name == "시험 덱_편집본.pptx"
    jpgs = [n for n in z.namelist() if re.fullmatch(r"ppt/media/.+\.jpe?g", n)]
    assert len(jpgs) == 1 and z.read(jpgs[0]) == (e.deck.parent / "pic.jpg").read_bytes()   # 그림은 원본 바이트 그대로
    ctx.close()
    assert errors == []


def test_pptx_can_stop_while_making(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"builder.html": BUILDER})
    base = serve(site)
    hub = DeckHub({"decks/builder.html": (root / "decks" / "builder.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    held = []
    page.route("**/vendor/pptxgenjs/pptxgen.bundle.js", lambda route: held.append(route))
    downloads = []
    page.on("download", lambda d: downloads.append(d))
    page.click("#pptx")
    expect(page.locator("#pxDlg")).to_be_visible()
    expect(page.locator("#pxText")).to_have_text("PPTX 도구를 불러오는 중…")
    page.keyboard.press("Escape")                      # Esc 도 그만두기 — 도구를 불러오는 중에도 기다리지 않고 멈춘다
    expect(page.locator("#status")).to_contain_text("PPTX 만들기를 그만두었습니다")
    expect(page.locator("#pxDlg")).to_be_hidden()
    assert downloads == [] and state(page)["cur"] == 0
    assert len(held) == 1
    held[0].continue_()                                # 불러오기는 뒤에서 마저 한다 — 다시 누르면 끝까지
    name, z = take(page, tmp_path)
    assert len(slides(z)) == 3
    ctx.close()
    assert errors == []


def test_pptx_stops_while_packing_and_keeps_the_selection(browser, tmp_path, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    click_box(page, "a")
    click_box(page, "b", "Shift")
    assert state(page)["sel"] == 2
    # 파일로 묶는 단계(JSZip.loadAsync)를 붙잡아 둔다
    page.evaluate("""async () => {
      await (await import('./js/pptx.js')).loadLib();
      const load = JSZip.loadAsync.bind(JSZip);
      window.__gate = new Promise((r) => { window.__open = r; });
      JSZip.loadAsync = async (...a) => { await window.__gate; return load(...a); };
    }""")
    downloads = []
    page.on("download", lambda d: downloads.append(d))
    page.click("#pptx")
    expect(page.locator("#pxText")).to_have_text("파일로 묶는 중…")
    page.locator("#pxDlg").evaluate("(d) => d.close()")      # 그래도 닫히면(잇따른 Esc) 그만두기로 보고 다시 연다
    expect(page.locator("#pxText")).to_have_text("그만두는 중…")
    assert page.locator("#pxDlg").evaluate("(d) => d.open") is True and page.locator("#pxStop").is_disabled()
    page.evaluate("window.__open()")
    expect(page.locator("#status")).to_contain_text("PPTX 만들기를 그만두었습니다")
    expect(page.locator("#pxDlg")).to_be_hidden()
    assert downloads == []
    st = state(page)
    assert st["cur"] == 1 and st["sel"] == 2 and st["undo"] == 0 and not st["dirty"]
    name, z = take(page, tmp_path)                     # 다시 누르면 끝까지 — 고른 상자는 그대로
    assert len(slides(z)) == 3 and state(page)["sel"] == 2
    ctx.close()
    assert errors == []


MOTION = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>움직임 시험 덱</title>
<style>
body{margin:0;font-family:"Malgun Gothic",sans-serif}
.deck{position:relative;width:1280px;height:720px}
.slide{position:absolute;inset:0;display:none;background:linear-gradient(135deg,#102040,#204080)}
.slide.on{display:block}
@keyframes up{from{opacity:0;transform:translateY(24px)}}
@keyframes spin{to{transform:rotate(360deg)}}
.slide h2{position:absolute;left:80px;top:100px;margin:0;font-size:40px;color:#FFFFFF;animation:up .6s both .3s}
.slide p{position:absolute;left:80px;top:220px;width:900px;margin:0;font-size:24px;color:#FFFFFF}
.dot{position:absolute;left:1100px;top:80px;width:40px;height:40px;background:#FFD400;animation:spin 2s linear infinite}
.odd{font-family:"A&B Sans",sans-serif}
</style></head><body><div class="deck">
<section class="slide on" id="s1" data-notes="노트에 제어CTRL 문자">
<h2>첫 장 제목</h2>
<p><a href="#s3">셋째 장으로</a> · <a href="other.html">다른 파일</a> · <a href="javascript:void(0)">스크립트</a> ·
<a href="https://example.com/x">바깥</a></p>
<div class="dot"></div>
</section>
<section class="slide" id="s2"><h2>둘째 장 제목</h2><p class="odd">세로 탭VT이 든 글</p></section>
<section class="slide" id="s3"><h2>셋째 장 제목</h2><p>끝</p></section>
</div></body></html>
""".replace("CTRL", chr(1)).replace("VT", chr(11))


def test_pptx_settles_motion_links_repeated_backgrounds_and_odd_text(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"motion.html": MOTION})
    base = serve(site)
    hub = DeckHub({"decks/motion.html": (root / "decks" / "motion.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "motion", hub)
    name, z = take(page, tmp_path)
    expect(page.locator("#status")).to_contain_text("그라데이션·배경 그림 3개")
    for n in z.namelist():                              # 모든 XML 이 올바르다(글·노트의 제어 문자, 글꼴 이름의 &)
        if n.endswith((".xml", ".rels")):
            ET.fromstring(z.read(n))
    s1, s2, s3 = slides(z)
    assert all(clean(x) for x in (s1, s2, s3))
    # 등장 애니메이션(.3s 뒤 투명에서 24px 올라옴)은 끝난 모습으로 — 제목이 빠지지 않고 제자리(위 100px = 952500 EMU)에
    for s, t in ((s1, "첫 장 제목"), (s2, "둘째 장 제목"), (s3, "셋째 장 제목")):
        sp = next(x for x in shapes(s) if f"<a:t>{t}</a:t>" in x)
        y = int(re.search(r'<a:off x="-?\d+" y="(-?\d+)"/>', sp).group(1))
        assert abs(y - 952500) <= 2 * 9525, (t, y)
    assert any('val="FFD400"' in sp for sp in shapes(s1))   # 끝없이 도는 것은 그 자리에 멈춘 도형으로
    # 링크 — 덱 안의 자리는 그 장으로, 바깥 주소는 그대로, 상대 주소·javascript: 는 글만
    rels = z.read("ppt/slides/_rels/slide1.xml.rels").decode("utf-8")
    assert "ppaction://hlinksldjump" in s1 and 'relationships/slide" Target="slide3.xml"' in rels
    assert "https://example.com/x" in rels and "other.html" not in rels and "javascript" not in rels
    assert "다른 파일" in "".join(texts(s1)) and "스크립트" in "".join(texts(s1))
    # 장마다 같은 배경 그림은 파일 안에 하나만
    media = [n for n in z.namelist() if n.startswith("ppt/media/") and not n.endswith("/")]
    assert len(media) == 1
    for k in (1, 2, 3):
        assert f'Target="../{media[0][4:]}"' in z.read(f"ppt/slides/_rels/slide{k}.xml.rels").decode("utf-8")
    # 글꼴 이름의 & 와 글·노트의 제어 문자는 빠진다
    assert 'typeface="AB Sans"' in s2 and "세로 탭이 든 글" in texts(s2)
    assert "노트에 제어 문자" in notes(z, 1)
    ctx.close()
    assert errors == []


def test_pptx_helpers(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"builder.html": BUILDER})
    base = serve(site)
    hub = DeckHub({"decks/builder.html": (root / "decks" / "builder.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    got = page.evaluate("""async () => {
      const m = await import('./js/pptx.js');
      const x = '<a:p><a:pPr algn="ctr"><a:buNone/></a:pPr><a:r><a:t>a</a:t></a:r><a:pPr algn="ctr"/><a:r><a:t>b</a:t></a:r>'
        + '<a:br/><a:pPr x="1"></a:pPr><a:r><a:t>c</a:t></a:r></a:p><a:p><a:r><a:t>d</a:t></a:r><a:pPr/></a:p>'
        + '<a:ea typeface="X" pitchFamily="34" charset="-122"/><a:ln></a:ln>';
      return {
        tidy: m.tidy(x),
        c1: m.rgba('rgb(1, 2, 3)'), c2: m.rgba('rgba(0, 0, 0, 0)'), c3: m.rgba('rgba(255, 0, 0, 0.5)'),
        c4: m.rgba('color(srgb 0 0.5 1)'), c5: m.rgba('transparent'),
        f1: m.face('"Bahnschrift", "Malgun Gothic", sans-serif'), f2: m.face('sans-serif'),
        f3: m.face('-apple-system, BlinkMacSystemFont, "Noto Sans KR"'), f4: m.face("'Noto Serif KR', serif"),
        f5: m.face('"A&B <Sans>", serif'),
        x1: m.clean('<a:t>a' + String.fromCharCode(0, 11, 31) + 'b' + String.fromCharCode(0xD800) + 'c'
          + String.fromCharCode(0xD83D, 0xDE00) + String.fromCharCode(0xDC00) + String.fromCharCode(9, 10, 13, 0xFFFE) + '</a:t>'),
      };
    }""")
    fffd = chr(0xFFFD)
    assert got["f5"] == "AB Sans"
    assert got["x1"] == f"<a:t>ab{fffd}c{chr(0x1F600)}{fffd}\t\n\r</a:t>"
    assert got["tidy"] == ('<a:p><a:pPr algn="ctr"><a:buNone/></a:pPr><a:r><a:t>a</a:t></a:r><a:r><a:t>b</a:t></a:r><a:br/>'
                           '<a:r><a:t>c</a:t></a:r></a:p><a:p><a:r><a:t>d</a:t></a:r></a:p><a:ea typeface="X"/>'
                           '<a:ln><a:noFill/></a:ln>')
    assert got["c1"] == {"hex": "010203", "a": 1} and got["c2"] is None and got["c5"] is None
    assert got["c3"] == {"hex": "FF0000", "a": 0.5} and got["c4"]["hex"] in ("0080FF", "007FFF")
    assert [got["f1"], got["f2"], got["f3"], got["f4"]] == ["Bahnschrift", "Malgun Gothic", "Noto Sans KR", "Noto Serif KR"]
    ctx.close()
    assert errors == []
