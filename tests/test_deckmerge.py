"""빌더 덱 다시 입히기(tools/deckmerge.py) — 옛 빌드·편집기에서 고친 판·새 빌드를 견주어 고친 곳만 새 빌드에 옮기는가.
편집기 저장본은 브라우저가 다시 쓴 꼴(<tbody>·따옴표·엔티티)을 흉내 내고, 편집 기록(deck-edits)과 상자 표식을 붙여 만든다."""
import json
import re
import time

import deckmerge as dm


def tx(name: str, text: str, top: int = 40, ref: str = "") -> str:
    mark = f' data-hs-ref="{ref}"' if ref else ""
    return (f'<div class="el tx" data-name="{name}"{mark} style="left:64px;top:{top}px;width:800px;height:40px">'
            f'<div class="tin"><p class="pp">{text}</p></div></div>')


def pageno(k: int, n: int) -> str:
    return tx("pageno", f"{k} / {n}", top=680)


def toc_of(slides, secs: dict[int, str]) -> str:
    """빌더 차례 — secs: 장 차례(0부터) → 그 장에서 시작하는 절 이름. 첫 장 링크가 지금 장(cur)."""
    out = []
    for i, (_, name, _) in enumerate(slides):
        if i in secs:
            out.append(f'<div class="sec">{secs[i]}</div>')
        cur = ' class="cur"' if i == 0 else ""
        out.append(f'<a href="#{i + 1}" data-go="{i}"{cur}><span class="n">{i + 1}</span><span>{name}</span></a>')
    return '<nav id="toc">' + "".join(out) + "</nav>"


def build(slides, notes=None, style=":root{--accent:#2563EB;--ink:#111111}", head="", title="시험 덱", toc=None) -> str:
    """slides: [(열쇠, 제목, [상자 글…])] — 빌더처럼 쪽 번호 상자를 장마다 붙인다. toc 는 차례 HTML(없으면 링크 하나)."""
    n = len(slides)
    secs = []
    for i, (key, name, boxes) in enumerate(slides):
        cls = "slide on" if i == 0 else "slide"
        body = "\n".join([*boxes, pageno(i + 1, n)])
        secs.append(f'<section class="{cls}" data-i="{i + 1}" data-key="{key}" data-title="{name}" '
                    f'aria-label="{i + 1}. {name}" style="background:#FFFFFF">\n{body}\n</section>')
    notes = notes if notes is not None else [f"{s[1]} 노트" for s in slides]
    return ("<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n"
            f"<title>{title}</title>\n<style>{style}\n.el{{position:absolute}}</style>\n{head}</head>\n<body>\n"
            + (toc if toc is not None else '<nav id="toc"><a href="#1" data-go="0">1</a></nav>') + "\n"
            '<div id="stage" class="stage">\n' + "\n".join(secs) + "\n</div>\n"
            f'<script type="application/json" id="notes-data">{json.dumps(notes, ensure_ascii=False)}</script>\n'
            f'<div id="cnt">1 / {n}</div>\n'
            "</body>\n</html>\n")


BASE = [("s1", "표지", [tx("title", "제목 하나"), tx("body", "본문 하나", 120)]),
        ("s2", "둘째", [tx("title", "둘째 제목"), tx("body", "둘째 본문", 120)]),
        ("s3", "셋째", [tx("title", "셋째 제목")])]


def browserish(html: str) -> str:
    """편집기 저장본이 받는 글자 차이 — 표에 <tbody>, <br/>→<br>, 숫자 엔티티 풀기."""
    html = re.sub(r"<table([^>]*)>(?!\s*<tbody)(.*?)</table>", r"<table\1><tbody>\2</tbody></table>", html, flags=re.S)
    return html.replace("<br/>", "<br>").replace("&#39;", "'")


def saved(base_html: str, edited_html: str) -> bytes:
    """편집기가 base 를 고쳐 저장한 파일(편집 기록 포함)."""
    return dm.stamp(browserish(edited_html), dm.blob_sha(base_html.encode("utf-8"))).encode("utf-8")


def merge(base_html: str, ours: bytes, theirs_html: str) -> dm.Result:
    return dm.reapply(base_html.encode("utf-8"), ours, theirs_html.encode("utf-8"))


def doc_of(r: dm.Result) -> dm.Doc:
    ov, plain = dm.read_edits(r.text)
    assert ov is not None and dm.sha256_text(plain) == ov["saved"]
    return dm.Doc(plain)


def texts(d: dm.Doc, key: str) -> list[str]:
    return [dm.text_content(n).strip() for _, n in dm.boxes(d.by_key[key])]


def idents(d: dm.Doc, key: str) -> list[str]:
    return [i for i, _ in dm.boxes(d.by_key[key])]


def notes(d: dm.Doc) -> list[str]:
    return json.loads(dm.style_text(d.ids["notes-data"]))


# ---------------------------------------------------------------- 기록

def test_edit_record_is_checked_against_the_file():
    text = build(BASE)
    data = dm.stamp(text, "a" * 40).encode("utf-8")
    ov = dm.edits_of(data)
    assert ov == {"v": 1, "build": "a" * 40, "saved": dm.sha256_text(text), "complete": True, "why": []}
    assert dm.read_edits(data.decode("utf-8"))[1] == text                  # 기록을 빼면 글자 그대로
    assert dm.edits_of(b"\xef\xbb\xbf" + data) == ov                     # BOM 은 세지 않는다
    assert dm.edits_of(data.replace("제목 하나".encode(), "제목 둘".encode())) is None   # 편집기 밖에서 고침
    assert dm.edits_of(dm.stamp(dm.stamp(text, "a" * 40), "b" * 40).encode("utf-8")) is None   # 기록이 둘
    assert dm.edits_of(text.encode("utf-8")) is None
    assert '<script type="application/json" id="deck-edits">' in data.decode("utf-8").split("</body>")[0]
    assert data.decode("utf-8").endswith("</script>\n</body>\n</html>\n")   # </body> 앞 공백보다 앞
    why = dm.stamp(text, "a" * 40, False, ["<script> 밖"])
    assert "<script> 밖" not in why and dm.edits_of(why.encode("utf-8"))["why"] == ["<script> 밖"]


# ---------------------------------------------------------------- 상자

def test_box_edits_go_onto_the_new_build():
    base = build(BASE)
    ours = saved(base, base.replace("제목 하나", "제목 하나 — 고침").replace("둘째 본문", "둘째 본문 — 고침"))
    theirs = build([BASE[0], ("s2", "둘째", [tx("title", "둘째 제목"), tx("body", "빌더가 바꾼 둘째 본문", 120)]),
                    ("s3", "셋째", [tx("title", "빌더가 바꾼 셋째 제목")])])
    r = merge(base, ours, theirs)
    assert r.edits and r.text and not r.refused
    d = doc_of(r)
    assert texts(d, "s1") == ["제목 하나 — 고침", "본문 하나", "1 / 3"]
    assert texts(d, "s2") == ["둘째 제목", "빌더가 바꾼 둘째 본문", "2 / 3"]   # 둘 다 바꾼 상자는 빌더 것
    assert texts(d, "s3") == ["빌더가 바꾼 셋째 제목", "3 / 3"]
    assert r.applied == ["고친 상자 1"]
    assert len(r.kept) == 1 and "2장 「둘째」의 본문 상자" in r.kept[0] and "빌더 것" in r.kept[0]
    assert dm.edits_of(r.text.encode("utf-8"))["build"] == dm.blob_sha(theirs.encode("utf-8"))


def test_browser_rewriting_alone_is_not_an_edit():
    base = build([("s1", "표", [tx("title", "표 제목"), '<table class="el"><tr><td>1</td><td>2&#39;</td></tr></table>',
                                tx("body", "첫 줄<br/>둘째 줄", 200)])])
    ours = saved(base, base)
    assert b"<tbody>" in ours and b"<br>" in ours
    theirs = base.replace("표 제목", "빌더가 바꾼 표 제목")
    r = merge(base, ours, theirs)
    assert r.edits is False and r.text is None and not r.refused


def test_deleted_added_and_marked_boxes():
    cards = [tx("card", f"카드 {k}", 100 * k) for k in (1, 2, 3)]
    base = build([("s1", "카드", cards)])
    # 둘째 카드를 지우고 첫째 뒤에 새 상자를 넣었다 — 셋째는 자리로 세면 둘째가 되어 표식을 단다
    edited = base.replace(cards[1] + "\n", "").replace(
        cards[0], cards[0] + "\n" + tx("note", "편집기에서 넣은 메모", 400, "+1")).replace(
        cards[2], tx("card", "카드 3", 300, "n:card#3"))
    ours = saved(base, edited)
    theirs = base.replace("카드 3", "빌더가 바꾼 카드 3")
    r = merge(base, ours, theirs)
    d = doc_of(r)
    assert texts(d, "s1") == ["카드 1", "편집기에서 넣은 메모", "빌더가 바꾼 카드 3", "1 / 1"]
    assert idents(d, "s1") == ["n:card#1", "+1", "n:card#3", "n:pageno#1"]
    assert sorted(r.applied) == sorted(["지운 상자 1", "더한 상자 1"]) and r.kept == []
    # 표식은 결과 차례로 다시 단다 — 새 상자는 '+1', 자리로 세면 어긋나는 셋째 카드만 'n:card#3'
    refs = [n.get(dm.REF_ATTR) for _, n in dm.boxes(d.by_key["s1"])]
    assert refs == [None, "+1", "n:card#3", None]


def test_deleted_box_that_the_builder_changed_is_kept():
    base = build([("s1", "하나", [tx("title", "제목"), tx("body", "본문", 120)])])
    ours = saved(base, base.replace(tx("body", "본문", 120) + "\n", ""))
    theirs = base.replace("본문", "빌더가 바꾼 본문")
    d = doc_of(r := merge(base, ours, theirs))
    assert texts(d, "s1") == ["제목", "빌더가 바꾼 본문", "1 / 1"]
    assert "편집기에서 지웠지만 빌더가 고쳐 남겼습니다" in r.kept[0]


def test_box_order_from_the_editor():
    a, b = tx("title", "제목"), tx("body", "본문", 120)
    base = build([("s1", "하나", [a, b])])
    ours = saved(base, base.replace(a + "\n" + b, b + "\n" + a))           # 앞뒤 차례를 바꿨다
    theirs = base.replace("본문", "빌더가 바꾼 본문")
    d = doc_of(r := merge(base, ours, theirs))
    assert texts(d, "s1") == ["빌더가 바꾼 본문", "제목", "1 / 1"]
    assert "상자 앞뒤 차례 1" in r.applied


# ---------------------------------------------------------------- 장

def test_slide_deleted_in_the_editor_renumbers_the_rest():
    base = build(BASE)
    edited = build([BASE[0], BASE[2]], notes=["표지 노트", "셋째 노트"])   # 편집기가 둘째 장을 지우고 번호를 다시 매김
    ours = saved(base, edited)
    theirs = build([BASE[0], BASE[1], ("s3", "셋째", [tx("title", "빌더가 바꾼 셋째 제목")])],
                   notes=["표지 노트", "둘째 노트", "빌더가 바꾼 셋째 노트"])
    d = doc_of(r := merge(base, ours, theirs))
    assert d.keys == ["s1", "s3"]
    s3 = d.by_key["s3"]
    assert s3.get("data-i") == "2" and s3.get("aria-label") == "2. 셋째"
    assert texts(d, "s3") == ["빌더가 바꾼 셋째 제목", "2 / 2"]               # 쪽 번호 상자는 새 차례로
    assert notes(d) == ["표지 노트", "빌더가 바꾼 셋째 노트"]
    assert dm.text_content(d.ids["cnt"]) == "1 / 2"
    assert "지운 장 1" in r.applied


def test_slide_added_by_the_builder_and_box_edit_by_the_editor():
    base = build(BASE)
    ours = saved(base, base.replace("둘째 본문", "둘째 본문 — 고침"))
    new = ("s1b", "새 장", [tx("title", "빌더가 더한 장")])
    theirs = build([BASE[0], new, BASE[1], BASE[2]])
    d = doc_of(r := merge(base, ours, theirs))
    assert d.keys == ["s1", "s1b", "s2", "s3"]
    assert texts(d, "s2") == ["둘째 제목", "둘째 본문 — 고침", "3 / 4"]
    assert r.applied == ["고친 상자 1"] and r.kept == []


def test_both_sides_change_slides():
    base = build(BASE)
    edited = build([BASE[0], BASE[1]], notes=["표지 노트", "둘째 노트"])     # 편집기: 셋째 장을 지움
    ours = saved(base, edited)
    theirs = build([*BASE, ("s4", "넷째", [tx("title", "빌더가 더한 넷째")])])  # 빌더: 넷째 장을 더함
    d = doc_of(merge(base, ours, theirs))
    assert d.keys == ["s1", "s2", "s4"]
    assert texts(d, "s4") == ["빌더가 더한 넷째", "3 / 3"]
    assert d.by_key["s4"].get("aria-label") == "3. 넷째"


def test_slide_added_and_moved_in_the_editor():
    base = build(BASE)
    added = ("s2_copy_1", "둘째 사본", [tx("title", "둘째 제목", ref="+1"), tx("body", "사본 본문", 120, "+2")])
    edited = build([BASE[0], BASE[2], BASE[1], added])                    # 둘째·셋째 차례를 바꾸고 끝에 장을 더함
    ours = saved(base, edited)
    theirs = base.replace("셋째 제목", "빌더가 바꾼 셋째 제목")
    d = doc_of(r := merge(base, ours, theirs))
    assert d.keys == ["s1", "s3", "s2", "s2_copy_1"]
    assert texts(d, "s3") == ["빌더가 바꾼 셋째 제목", "2 / 4"]
    assert texts(d, "s2_copy_1") == ["둘째 제목", "사본 본문", "4 / 4"]
    assert [s.get("data-i") for s in d.slides] == ["1", "2", "3", "4"]
    assert "on" in d.slides[0].classes() and all("on" not in s.classes() for s in d.slides[1:])
    assert {"장 차례 1", "더한 장 1"} <= set(r.applied)


# ---------------------------------------------------------------- 노트·변수·블록

def test_notes_merge_by_slide_key():
    base = build(BASE)
    ours = saved(base, build(BASE, notes=["표지 노트", "편집기가 고친 둘째 노트", "셋째 노트"]))
    theirs = build(BASE, notes=["빌더가 고친 표지 노트", "둘째 노트", "셋째 노트"])
    d = doc_of(r := merge(base, ours, theirs))
    assert notes(d) == ["빌더가 고친 표지 노트", "편집기가 고친 둘째 노트", "셋째 노트"]
    assert r.applied == ["노트 1"]
    raw = d.text[d.ids["notes-data"].inner:d.ids["notes-data"].close]
    assert "<" not in raw


def test_root_variables_merge_one_by_one():
    base = build(BASE)
    ours = saved(base, build(BASE, style=":root{--accent:#B91C1C;--ink:#111111}"))
    theirs = build(BASE, style=":root{--accent:#2563EB;--ink:#000000}\n.new{color:red}")
    d = doc_of(r := merge(base, ours, theirs))
    css = dm.style_text(dm.deck_styles(d)[0])
    assert dm.vars_of(css) == {("--accent", 1): "#B91C1C", ("--ink", 1): "#000000"} and ".new{color:red}" in css
    assert r.applied == ["덱 색·글꼴 1"]
    both = merge(base, ours, build(BASE, style=":root{--accent:#15803D;--ink:#111111}"))
    assert "#15803D" in doc_of(both).text and "덱 색·글꼴 --accent" in both.kept[0]


LAYOUT = ('<style id="deck-layout-css">.hsl{position:absolute}</style>'
          '<script type="application/json" id="deck-layout">{"v":1,"page":{"on":true,"fmt":"{n} / {N}","pos":"br",'
          '"cover":false,"start":1},"foot":{"on":true,"text":"KINAC & 학회","pos":"bl","cover":true},"logos":[]}</script>\n')


def test_page_layout_is_carried_and_redrawn():
    base = build(BASE)
    foot = '<div class="hsl hsl-bl" data-deck-layout="bl"><span class="hsl-foot">KINAC &amp; 학회</span></div>'
    page = '<div class="hsl hsl-br" data-deck-layout="br"><span class="hsl-page">{} / {}</span></div>'
    zones = lambda i, n: foot + ("" if i == 0 else page.format(i + 1, n))  # noqa: E731
    edited = build(BASE, head=LAYOUT)
    for i, (key, _, _) in enumerate(BASE):
        sec_end = edited.index("</section>", edited.index(f'data-key="{key}"'))
        edited = edited[:sec_end] + zones(i, 3) + edited[sec_end:]
    ours = saved(base, edited)
    theirs = build([BASE[0], BASE[1], ("s2b", "새 장", [tx("title", "빌더가 더한 장")]), BASE[2]])
    d = doc_of(r := merge(base, ours, theirs))
    assert d.keys == ["s1", "s2", "s2b", "s3"]
    assert "deck-layout" in d.ids and "deck-layout-css" in d.ids and d.ids["deck-layout"].parent is d.head
    for i, key in enumerate(d.keys):
        got = "".join(d.span(z) for z in d.by_key[key].elements() if dm.is_zone(z))
        assert got == zones(i, 4), key
    assert {"쪽 레이아웃 모양 1", "쪽 레이아웃 설정 1"} <= set(r.applied)


def test_index_block_is_carried():
    base = build(BASE)
    edited = base.replace("</body>", '<script type="application/json" id="deck-index">["핵분열"]</script>\n</body>')
    d = doc_of(r := merge(base, saved(base, edited), base.replace("본문 하나", "빌더가 바꾼 본문")))
    assert dm.style_text(d.ids["deck-index"]) == '["핵분열"]' and texts(d, "s1")[1] == "빌더가 바꾼 본문"
    assert r.applied == ["색인에 더한 말 1"]


SECS = {0: "1부", 1: "2부"}


def toc_entry(i: int, name: str) -> str:
    """편집기 rebuildToc 가 짓는 링크 — 첫 링크를 본떠(cur 는 떼고) 번호·제목을 담는다."""
    return f'<a href="#{i + 1}" data-go="{i}" class=""><span class="n">{i + 1}</span><span>{name}</span></a>'


def test_toc_is_rebuilt_from_the_result():
    base = build(BASE, toc=toc_of(BASE, SECS))
    # 편집기: 둘째 장 이름을 바꾸고 끝에 장을 더함 — 편집기가 다시 지은 차례(옛 절 이름)는 견주지 않는다
    renamed = ("s2", "둘째 — 새 이름", BASE[1][2])
    added = ("s3_copy_1", "셋째 사본", [tx("title", "사본 제목", ref="+1")])
    mine = [BASE[0], renamed, BASE[2], added]
    ours = saved(base, build(mine, notes=["표지 노트", "둘째 노트", "셋째 노트", ""], toc=toc_of(mine, SECS)))
    # 빌더: 본문을 바꾸고 둘째 절 이름을 바꿈
    theirs = build(BASE, toc=toc_of(BASE, {0: "1부", 1: "제2부"})).replace("본문 하나", "빌더가 바꾼 본문")
    d = doc_of(r := merge(base, ours, theirs))
    assert d.keys == ["s1", "s2", "s3", "s3_copy_1"] and texts(d, "s1")[1] == "빌더가 바꾼 본문"
    s2 = d.by_key["s2"]
    assert s2.get("data-title") == "둘째 — 새 이름" and s2.get("aria-label") == "2. 둘째 — 새 이름"
    # 절은 새 빌드의 차례에서 그 장이 든 절, 새 장은 앞 장의 절 — 제목은 결과의 data-title
    want = ('<nav id="toc"><div class="sec">1부</div>' + toc_entry(0, "표지") + '<div class="sec">제2부</div>'
            + toc_entry(1, "둘째 — 새 이름") + toc_entry(2, "셋째") + toc_entry(3, "셋째 사본") + "</nav>")
    assert d.span(d.ids["toc"]) == want
    assert set(r.applied) == {"장 속성 1", "더한 장 1"}
    # 장 차례·제목이 그대로면 새 빌드의 차례를 건드리지 않는다
    d2 = doc_of(merge(base, saved(base, base.replace("제목 하나", "제목 하나 — 고침")), theirs))
    t = dm.Doc(theirs)
    assert d2.span(d2.ids["toc"]) == t.span(t.ids["toc"])


def test_change_outside_slides_is_reported():
    base = build(BASE)
    ours = saved(base, base.replace("<title>시험 덱</title>", "<title>고친 제목</title>").replace("제목 하나", "제목 하나 — 고침"))
    r = merge(base, ours, base.replace("본문 하나", "빌더가 바꾼 본문"))
    d = doc_of(r)
    assert "<title>시험 덱</title>" in d.text and texts(d, "s1")[0] == "제목 하나 — 고침"
    assert any("장 밖의 다른 고침" in k for k in r.kept)


# ---------------------------------------------------------------- 거절·되풀이

def test_refusals():
    base = build(BASE)
    plain = base.replace("제목 하나", "고침").encode("utf-8")
    assert "편집 기록" in merge(base, plain, base).refused
    tampered = saved(base, base.replace("제목 하나", "고침")).replace("본문 하나".encode(), "밖에서 고침".encode())
    assert "편집 기록" in merge(base, tampered, base).refused
    ours = saved(base, base.replace("제목 하나", "고침"))
    assert "빌드가 아닙니다" in merge(base, ours, dm.stamp(base, "c" * 40)).refused
    flow = "<html><body><section class='slide'>a</section><section class='slide'>b</section></body></html>"
    assert "빌더 덱 꼴" in merge(base, ours, flow).refused
    dup = base.replace('data-key="s2"', 'data-key="s1"')
    assert "열쇠" in merge(base, ours, dup).refused


def test_second_round_starts_from_the_result():
    base = build(BASE)
    ours = saved(base, base.replace("제목 하나", "제목 하나 — 고침"))
    theirs = base.replace("셋째 제목", "빌더 1차")
    first = merge(base, ours, theirs)
    again = merge(theirs, first.text.encode("utf-8"), theirs)               # 같은 빌드로 다시 — 결과가 그대로
    assert again.text == first.text
    theirs2 = theirs.replace("둘째 제목", "빌더 2차")
    second = merge(theirs, first.text.encode("utf-8"), theirs2)
    d = doc_of(second)
    assert texts(d, "s1")[0] == "제목 하나 — 고침" and texts(d, "s2")[0] == "빌더 2차" and texts(d, "s3")[0] == "빌더 1차"


# ---------------------------------------------------------------- 빌더가 없앤 장·끼운 상자·다르게 읽은 HTML

def test_edit_on_a_slide_the_builder_removed_or_rekeyed_is_reported():
    base = build(BASE)
    ours = saved(base, base.replace("둘째 본문", "둘째 본문 — 고침"))
    gone = merge(base, ours, build([BASE[0], BASE[2]]))                   # 빌더가 둘째 장을 없앰
    assert doc_of(gone).keys == ["s1", "s3"]
    assert any("2장 「둘째」 — 편집기에서 고쳤지만 빌더가 그 장을 없앴거나" in k for k in gone.kept)
    rekeyed = merge(base, ours, build([BASE[0], ("s2-new", "둘째", BASE[1][2]), BASE[2]]))   # 열쇠만 바꿈
    d = doc_of(rekeyed)
    assert d.keys == ["s1", "s2-new", "s3"] and texts(d, "s2-new")[1] == "둘째 본문"
    assert any("장 열쇠(data-key)를 바꿔" in k for k in rekeyed.kept)
    # 고치지 않은 장을 빌더가 없앤 것은 알리지 않는다
    quiet = merge(base, saved(base, base.replace("제목 하나", "제목 하나 — 고침")), build([BASE[0], BASE[2]]))
    assert quiet.kept == [] and quiet.applied == ["고친 상자 1"]


def test_box_edits_follow_the_box_when_the_builder_inserts_one_before_it():
    card = lambda k, t: tx("card", t, 100 * k)  # noqa: E731
    base = build([("s1", "카드", [card(1, "카드 1"), card(2, "카드 2")])])
    ours = saved(base, base.replace("카드 2", "카드 2 — 고침"))
    theirs = build([("s1", "카드", [card(0, "빌더가 넣은 카드"), card(1, "카드 1"), card(2, "카드 2")])])
    d = doc_of(r := merge(base, ours, theirs))
    assert texts(d, "s1") == ["빌더가 넣은 카드", "카드 1", "카드 2 — 고침", "1 / 1"]   # 자리로 세면 둘째지만 글로 짝짓는다
    assert idents(d, "s1") == ["n:card#1", "n:card#2", "n:card#3", "n:pageno#1"] and r.applied == ["고친 상자 1"]
    assert all(n.get(dm.REF_ATTR) is None for _, n in dm.boxes(d.by_key["s1"]))     # 새 빌드 자리 그대로라 표식이 없다
    # 빌더가 같은 무리의 상자를 바꾸면서 하나를 더 넣으면 고친 상자가 어느 것인지 알 수 없다 — 알리고 빌더 것을 따른다
    ours2 = saved(base, base.replace("카드 1", "카드 1 — 고침"))
    theirs2 = build([("s1", "카드", [card(0, "빌더가 넣은 카드"), card(1, "빌더가 바꾼 카드 1"), card(2, "카드 2")])])
    d2 = doc_of(r2 := merge(base, ours2, theirs2))
    assert texts(d2, "s1") == ["빌더가 넣은 카드", "빌더가 바꾼 카드 1", "카드 2", "1 / 1"]
    assert len(r2.kept) == 1 and "card 상자 — 빌더가 같은 무리의 상자를 바꾸거나 없애 어느 상자인지 알 수 없어" in r2.kept[0]


def test_both_sides_deleting_the_same_thing_is_not_a_conflict():
    base = build(BASE)
    short = [BASE[0], ("s2", "둘째", [tx("title", "둘째 제목")])]           # 둘째 본문 상자와 셋째 장을 지움
    r = merge(base, saved(base, build(short, notes=["표지 노트", "둘째 노트"])), build(short, notes=["표지 노트", "둘째 노트"]))
    assert (r.edits, r.text, r.refused, r.kept) == (False, None, "", [])
    # 편집기에서 옮긴 상자를 빌더가 없앴다 — 옮긴 것은 뜻이 없어졌을 뿐 놓친 고침이 아니다
    a, b = tx("title", "제목"), tx("body", "본문", 120)
    one = build([("s1", "하나", [a, b])])
    r2 = merge(one, saved(one, one.replace(a + "\n" + b, b + "\n" + a)), build([("s1", "하나", [a])]))
    assert (r2.edits, r2.refused) == (False, "")


def test_html_the_browser_reads_differently_is_refused():
    odd = '<p class="el">글<table><tr><td>1</td></tr></table></p>'
    base = build([("s1", "문단", [tx("title", "머리"), odd])])
    # 브라우저는 <p> 안의 표를 밖으로 꺼내 읽는다 — 편집기 저장본에는 <p> 둘과 표가 따로 있다
    edited = base.replace(odd, '<p class="el">글</p><table><tbody><tr><td>1</td></tr></tbody></table><p></p>')
    r = merge(base, saved(base, edited.replace("머리", "머리 — 고침")), base.replace("머리", "빌더가 바꾼 머리"))
    assert r.text is None and r.edits
    assert r.refused.startswith("1장 「문단」 — 편집기(브라우저)와 이 도구가 상자를 다르게 읽어(표 상자, <p> 상자 2)")


def test_deep_html_and_json_neither_crash_nor_crawl():
    deep = tx("body", "<ul>" + "<li>항목" * 5000 + "</ul>", 120)          # 닫는 태그 없는 목록 — 이 도구는 5천 단으로 읽는다
    base = build([("s1", "깊음", [tx("title", "머리"), deep]), BASE[1]])
    ours = saved(base, base.replace("머리", "머리 — 고침"))
    theirs = build([("s0", "빌더가 더한 장", [tx("title", "새 장")]), ("s1", "깊음", [tx("title", "머리"), deep]), BASE[1]])
    t0 = time.perf_counter()
    d = doc_of(r := merge(base, ours, theirs))                              # 장이 밀려 쪽 번호를 다시 매기는 길까지
    assert time.perf_counter() - t0 < 10
    assert texts(d, "s1")[0] == "머리 — 고침" and texts(d, "s1")[2] == "2 / 3" and r.applied == ["고친 상자 1"]
    # 노트 JSON 이 아주 깊어도(읽지 못하는 노트) 죽지 않는다
    raw = json.dumps(["빌더가 더한 장 노트", "깊음 노트", "둘째 노트"], ensure_ascii=False)
    r2 = merge(base, ours, theirs.replace(raw, "[" * 100000 + "]" * 100000))
    assert r2.text is not None and texts(doc_of(r2), "s1")[0] == "머리 — 고침"


def test_page_number_deep_in_a_box_is_renumbered_quickly():
    """글이 짧은 채로 아주 깊게 겹친 상자 — 요소마다 글을 다시 모으거나 후보끼리 견주면 단마다 다시 훑어 멈춘 듯 느려진다
    (2만 단에서 한 번 훑으면 0.1초도 안 걸리고, 단마다 다시 훑으면 1분쯤)."""
    def s1(k: int, n: int):                                 # 둘째 상자 — div 2만 단 맨 아래에 쪽 번호만
        chain = "<div>" * 20000 + f"{k} / {n}" + "</div>" * 20000
        box = f'<div class="el" data-name="chain" style="left:64px;top:300px;width:800px;height:40px">{chain}</div>'
        return ("s1", "깊은 번호", [tx("title", "머리"), box])

    base = build([s1(1, 2), BASE[1]])
    ours = saved(base, base.replace("머리", "머리 — 고침"))
    theirs = build([("s0", "빌더가 더한 장", [tx("title", "새 장")]), s1(2, 3), BASE[1]])
    slide = dm.Doc(base).by_key["s1"]
    t0 = time.perf_counter()
    targets = dm._page_targets(slide, (1, 2))
    assert time.perf_counter() - t0 < 1
    assert [n.tag for n in targets] == ["div", "p"]                         # 가장 깊은 div 와 쪽 번호 상자 안의 <p>
    assert dm.text_content(targets[0]) == "1 / 2" and not targets[0].elements()
    t0 = time.perf_counter()
    d = doc_of(merge(base, ours, theirs))
    assert time.perf_counter() - t0 < 8
    assert texts(d, "s1") == ["머리 — 고침", "2 / 3", "2 / 3"]


def test_unreadable_notes_changed_in_the_editor_are_reported():
    raw = json.dumps(["표지 노트", "둘째 노트", "셋째 노트"], ensure_ascii=False)
    base = build(BASE).replace(raw, "노트 아님")
    r = merge(base, saved(base, base.replace("노트 아님", "노트 아님 — 고침")), base)
    assert r.text is not None and r.kept == ["노트 — 새 빌드의 노트를 읽지 못해 다시 입히지 않았습니다"]


def test_guards_refuse_when_an_edit_slips_through(monkeypatch):
    base = build(BASE)
    ours = saved(base, base.replace("제목 하나", "제목 하나 — 고침"))
    theirs = base.replace("셋째 제목", "빌더가 바꾼 셋째 제목")
    orig = dm._Merge.slide_text

    def blind(self, key, at, total, settings):          # 고친 것을 하나도 짚지 못하는 규칙(흉내)
        self.titles[key] = self.T.by_key[key].get("data-title") or ""
        return self.T.span(self.T.by_key[key])

    monkeypatch.setattr(dm._Merge, "slide_text", blind)
    r = merge(base, ours, theirs)
    assert r.text is None and r.refused == "1장 「표지」 — 편집기 판이 옛 빌드와 다른데 고친 곳을 짚지 못했습니다"

    def lossy(self, key, at, total, settings):          # 고친 것을 세고도 결과에 옮기지 못하는 규칙(흉내)
        out = orig(self, key, at, total, settings)
        return self.T.span(self.T.by_key[key]) if key == "s1" else out

    monkeypatch.setattr(dm._Merge, "slide_text", lossy)
    r = merge(base, ours, theirs)
    assert r.text is None and r.refused.endswith("(1장 「표지」 — 편집기 판과 다름)")


def test_toc_numbers_read_like_javascript():
    got = [dm._js_int(v) for v in ("0", " 2 ", "", "1.0", "0x10", "1e1", "1.5", "abc", "1_0", "Infinity")]
    assert got == [0, 2, 0, 1, 16, 10, None, None, None, None]
