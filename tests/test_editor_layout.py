"""덱 편집기 5단계 — 글상자 넣기·지우기·복제·복사·붙여 넣기와 쪽 레이아웃(쪽 번호·꼬리말·로고).
브라우저(Playwright)로 눌러 보고, 저장은 GitHub contents API 를 가로챈 DeckHub 에서 본다(시험 틀은 test_editor.py 의 것)."""
import json

import pytest

from test_editor import (  # noqa: F401 — browser·serve·decks 는 fixture
    BUILDER, FLOW, PNG_2x1, browser, caret, deck_site, decks, drag, frame, open_editor, parse_saved, pw, run_saved,
    same_dom, save_with_token, serve, state, wait_saved,
)

LOGO = PNG_2x1                                              # 2×1 PNG — 로고 높이 36px 이면 너비 72px


def zones(page) -> list:
    """장마다 쪽 레이아웃 자리 상자 [[자리, [로고 수, 꼬리말, 쪽 번호]], …]."""
    return frame(page).locator("section.slide").evaluate_all("""(ss) => ss.map((s) =>
        [...s.querySelectorAll(':scope > [data-deck-layout]')].map((z) => [z.getAttribute('data-deck-layout'),
            z.querySelectorAll('.hsl-logo').length, (z.querySelector('.hsl-foot') || {}).textContent || '',
            (z.querySelector('.hsl-page') || {}).textContent || '']))""")


def saved_zones(page, text: str) -> list:
    return page.evaluate("""(t) => {
        const d = new DOMParser().parseFromString(t, 'text/html');
        return [...d.querySelectorAll('section.slide')].map((s) =>
            [...s.querySelectorAll(':scope > [data-deck-layout]')].map((z) => [z.getAttribute('data-deck-layout'),
                z.querySelectorAll('.hsl-logo').length, (z.querySelector('.hsl-foot') || {}).textContent || '',
                (z.querySelector('.hsl-page') || {}).textContent || '']));
    }""", text)


# ---------- 글상자

def test_builder_text_box_insert_type_delete_and_save(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    assert page.is_disabled("#boxDel") and page.is_disabled("#boxDup") and page.is_disabled("#boxPaste")
    page.click("#txtBtn")
    sec = frame(page).locator("section.slide").nth(1)
    box = sec.locator(":scope > .el.tx[data-name^=text-]")
    assert box.count() == 1 and state(page)["undo"] == 1
    # 장 가운데에, 덱 본문 글의 모양(24px·줄 높이 31.2px·#222)으로 — 높이는 한 줄
    assert state(page)["box"] == {"x": 320, "y": 342, "w": 640, "h": 36}
    p = box.locator(".tin > p.pp")
    assert p.evaluate("(e) => [e.style.fontSize, e.style.lineHeight, e.style.color]") == ["24px", "31.2px", "rgb(34, 34, 34)"]
    # 안내 글이 통째로 골라져 있어 바로 치면 덮어 쓰고, Enter 는 같은 모양의 새 문단
    page.keyboard.type("새 글상자")
    page.keyboard.press("Enter")
    page.keyboard.type("둘째 줄")
    page.wait_for_timeout(900)
    assert box.locator(".tin > p.pp").all_inner_texts() == ["새 글상자", "둘째 줄"]
    assert box.locator(".tin > p.pp").nth(1).evaluate("(e) => e.style.fontSize") == "24px"
    assert not page.is_disabled("#boxDel") and not page.is_disabled("#boxDup")
    undo = state(page)["undo"]
    page.click("#boxDel")                                  # 고른 상자(글을 고치던 글상자)째 지운다
    assert box.count() == 0 and state(page)["box"] is None and state(page)["undo"] == undo + 1
    page.keyboard.press("Control+z")
    assert box.count() == 1
    save_with_token(page)
    wait_saved(page, hub)
    text = hub.saved("decks/builder.html")
    s = parse_saved(page, text)
    assert s["hse"] is False and s["editable"] == 0
    got = page.evaluate("""(t) => { const d = new DOMParser().parseFromString(t, 'text/html');
        const b = d.querySelectorAll('section.slide')[1].querySelector(':scope > [data-name^=text-]');
        return [b.className, b.getAttribute('style'), [...b.querySelectorAll('.tin > p.pp')].map((p) => p.textContent)]; }""", text)
    assert got == ["el tx", "left:320px;top:342px;width:640px;height:36px", ["새 글상자", "둘째 줄"]]
    ctx.close()
    assert errors == []


def test_text_box_on_a_dark_slide_gets_readable_text(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.click("#txtBtn")                                  # 표지(어두운 바탕) — 본문 글색(#222)이면 읽히지 않는다
    color = frame(page).locator("section.slide").nth(0).locator("[data-name^=text-] p").evaluate("(e) => e.style.color")
    assert color == "rgb(255, 255, 255)"
    ctx.close()
    ctx, page, errors2 = open_editor(browser, base, "flow", hub)
    page.click("#txtBtn")
    assert frame(page).locator("section.slide").nth(0).locator("[data-hs-box] p").evaluate(
        "(e) => getComputedStyle(e).color") == "rgb(255, 255, 255)"
    page.keyboard.press("Escape")                          # 글 고치기를 마치고(글 칸 안의 PageDown 은 글의 것)
    page.keyboard.press("PageDown")
    page.click("#txtBtn")                                  # 흰 장에는 검은 글
    assert frame(page).locator("section.slide").nth(1).locator("[data-hs-box] p").evaluate(
        "(e) => getComputedStyle(e).color") == "rgb(0, 0, 0)"
    ctx.close()
    assert errors == [] and errors2 == []


def test_flow_text_box_moves_like_a_builder_box_and_survives_save(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    page.keyboard.press("PageDown")
    page.click("#txtBtn")
    sec = frame(page).locator("section.slide").nth(1)
    box = sec.locator(":scope > [data-hs-box]")
    page.keyboard.type("흐름 글상자")
    page.keyboard.press("Enter")                           # 흐름 덱 글상자도 문단을 나눈다
    page.keyboard.type("둘째")
    page.wait_for_timeout(900)
    assert box.locator(":scope > p").all_inner_texts() == ["흐름 글상자", "둘째"]
    assert box.evaluate("(e) => getComputedStyle(e).position") == "absolute"
    assert page.locator("#bX").is_visible()                # 흐름 덱인데도 자리 칸이 보인다(옮길 수 있는 상자)
    g0 = state(page)["box"]
    s = state(page)["scale"]
    drag(page, ".pick-edge.top", 40 * s, 30 * s, at=0.25)
    g1 = state(page)["box"]
    assert (g1["x"] - g0["x"], g1["y"] - g0["y"], g1["w"], g1["h"]) == (40, 30, g0["w"], g0["h"])
    save_with_token(page)
    wait_saved(page, hub)
    ctx.close()
    # 다시 열어도 같은 상자로 고르고 옮긴다
    ctx, page, errors2 = open_editor(browser, base, "flow", hub)
    page.keyboard.press("PageDown")
    frame(page).locator("[data-hs-box] p").first.click()
    assert state(page)["box"] == g1 and page.locator("#bX").is_visible()
    page.keyboard.press("Escape")                          # 글 고치기를 마치고
    page.keyboard.press("Delete")                          # 상자를 지운다
    assert frame(page).locator("[data-hs-box]").count() == 0
    ctx.close()
    assert errors == [] and errors2 == []


# ---------- 복제·복사·붙여 넣기

def test_duplicate_copy_cut_paste_between_slides(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    original = page.evaluate("window.__hse.serialize()")
    page.keyboard.press("PageDown")
    f = frame(page)
    f.locator("section.slide").nth(1).locator("svg.el").click()
    page.click("#boxDup")                                  # 조금 비켜 맨 위에 — 복제한 것이 골라진다
    assert f.locator("section.slide").nth(1).locator("svg.el").count() == 2
    assert state(page)["box"] == {"x": 80, "y": 416, "w": 200, "h": 20}
    ids = f.locator("marker").evaluate_all("(ms) => ms.map((m) => m.id)")
    assert len(ids) == 2 and len(set(ids)) == 2            # 안의 id 는 새 이름, 화살표는 제 marker 를 가리킨다
    assert f.locator("section.slide").nth(1).locator("svg.el").nth(1).evaluate(
        "(s) => s.querySelector('line').getAttribute('marker-end') === `url(#${s.querySelector('marker').id})`")
    page.keyboard.press("Control+c")
    assert state(page)["clip"] and not page.is_disabled("#boxPaste")
    page.keyboard.press("PageDown")
    page.keyboard.press("Control+v")                       # 다른 장에는 같은 자리에
    assert f.locator("section.slide").nth(2).locator("svg.el").count() == 1 and state(page)["box"]["x"] == 80
    page.keyboard.press("Control+v")                       # 같은 자리에 이미 있으면 비켜서
    assert state(page)["box"]["x"] == 96
    page.keyboard.press("Control+x")                       # 잘라 내면 고른 것이 없다
    assert f.locator("section.slide").nth(2).locator("svg.el").count() == 1 and state(page)["box"] is None
    page.keyboard.press("Control+v")                       # 잘라 낸 자리(96, 432)가 비어 그 자리에
    assert state(page)["box"] == {"x": 96, "y": 432, "w": 200, "h": 20}
    page.keyboard.press("Control+d")                       # Ctrl+D 복제
    assert f.locator("section.slide").nth(2).locator("svg.el").count() == 3 and state(page)["box"]["x"] == 112
    # 쪽 번호 상자를 표지에 붙이면 표지의 번호가 된다(저장할 때 그 장의 번호로)
    f.locator("section.slide").nth(2).locator("[data-name=pageno] p").click()
    page.keyboard.press("Escape")                          # 글 고치기를 마치면 Ctrl+C 는 상자를 복사한다
    page.keyboard.press("Control+c")
    page.click("#toc li >> nth=0")
    page.keyboard.press("Control+v")
    assert f.locator("section.slide").nth(0).locator("[data-name=pageno]").count() == 1
    s = parse_saved(page, page.evaluate("window.__hse.serialize()"))
    assert s["pageno"] == ["1 / 3", "2 / 3", "3 / 3"]
    for _ in range(state(page)["undo"]):
        page.keyboard.press("Control+z")
    assert page.evaluate("window.__hse.serialize()") == original
    ctx.close()
    assert errors == []


def test_flow_delete_and_duplicate_act_on_the_text_being_edited(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    page.keyboard.press("PageDown")
    sec = frame(page).locator("section.slide").nth(1)
    sec.locator("li", has_text="둘").click()
    pw.expect(page.locator("#boxDel")).to_be_enabled()     # 선택이 바뀐 것(selectionchange)은 조금 뒤에 온다
    assert "글을 고치던" in page.get_attribute("#boxDel", "title")
    page.click("#boxDel")                                  # 목록은 그 항목만
    assert sec.locator("li").all_inner_texts() == ["하나"]
    page.keyboard.press("Control+z")
    assert sec.locator("li").all_inner_texts() == ["하나", "둘"]
    sec.locator("h2").click()
    page.wait_for_timeout(200)
    page.click("#boxDup")                                  # 제목은 바로 뒤에 복제
    assert sec.locator("h2").all_inner_texts() == ["둘째 장", "둘째 장"]
    page.keyboard.press("Control+z")
    assert sec.locator("h2").count() == 1
    ctx.close()
    assert errors == []


# ---------- 쪽 레이아웃

def open_layout(page) -> None:
    page.click("#layoutBtn")
    pw.expect(page.locator("#pageDlg")).to_be_visible()


def test_page_layout_puts_numbers_footer_and_one_logo_on_every_slide(browser, decks, tmp_path, serve):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    original = page.evaluate("window.__hse.serialize()")
    open_layout(page)
    # 덱에 원래 쪽 번호가 있어 기본은 끔 — 원래 것의 모양(크기·자리)을 기본값으로
    assert not page.is_checked("#pPageOn") and "2개 장" in page.inner_text("#pOldPage")
    assert (page.input_value("#pPagePos"), page.input_value("#pMx"), page.input_value("#pMy")) == ("br", "50", "20")
    page.click("#pOldPageDel")
    assert frame(page).locator("[data-name=pageno]").count() == 2 and "한 번 더" in page.inner_text("#pOldPageDel")
    page.click("#pOldPageDel")                             # 한 번 더 눌러야 지운다 — 되돌리기 한 칸
    assert frame(page).locator("[data-name=pageno]").count() == 0 and state(page)["undo"] == 1
    page.check("#pPageOn")
    page.select_option("#pPageFmt", "{n}")
    page.fill("#pFootText", "시험 학회 2026")              # 글을 쓰면 ‘꼬리말 넣기’가 켜진다
    assert page.is_checked("#pFootOn")
    png = tmp_path / "기관_로고.png"
    png.write_bytes(LOGO)
    page.set_input_files("#pLogoFile", str(png))
    pw.expect(page.locator("#pLogos .p-logo")).to_have_count(1)
    assert page.input_value("#pLogos input[type=text]") == "기관 로고"
    page.click("#pApply")
    assert "모든 장(3장)에 적용" in page.inner_text("#pStatus") and state(page)["undo"] == 2
    # 표지에는 로고만(쪽 번호·꼬리말은 ‘표지에도’가 꺼져 있다), 나머지 장에는 셋 다
    assert zones(page) == [[["tr", 1, "", ""]], [["tr", 1, "", ""], ["bl", 0, "시험 학회 2026", ""], ["br", 0, "", "2"]],
                           [["tr", 1, "", ""], ["bl", 0, "시험 학회 2026", ""], ["br", 0, "", "3"]]]
    page.click("#pClose")
    pw.expect(page.locator("#pageDlg")).to_be_hidden()
    # 자리 — 장 오른쪽 아래에서 여백만큼, 로고는 2:1 그대로 높이 36px
    sl = frame(page).locator("section.slide").nth(0)
    assert sl.locator(".hsl-logo").evaluate("(e) => { const r = e.getBoundingClientRect(); return [r.right, r.top, r.width, r.height]; }") \
        == [1230, 20, 72, 36]
    # 새 장에도 붙고, 장 순서를 바꾸면 번호가 따라간다
    page.click("#toc li >> nth=1")
    page.click("#add")                                     # 표지 · 둘째 · 새 장 · 셋째
    page.click("#up")                                      # 표지 · 새 장 · 둘째 · 셋째
    assert [z[-1][3] for z in zones(page)] == ["", "2", "3", "4"]
    save_with_token(page)
    wait_saved(page, hub)
    text = hub.saved("decks/builder.html")
    s = parse_saved(page, text)
    assert s["titles"] == ["표지", "새 장", "둘째", "셋째"] and s["hse"] is False
    assert s["scripts"] == ["deck-layout", "notes-data", "deck-js", "deck-edits"]
    assert text.count("data:image/png;base64,") == 1      # 로고 그림은 덱에 한 번만
    assert saved_zones(page, text) == zones(page)
    conf = page.evaluate("(t) => JSON.parse(new DOMParser().parseFromString(t, 'text/html').getElementById('deck-layout').textContent)", text)
    assert conf["page"]["fmt"] == "{n}" and conf["foot"]["text"] == "시험 학회 2026" and len(conf["logos"]) == 1
    ctx.close()
    # 저장된 덱을 보통 브라우저에서 — 덱 스크립트가 장을 넘겨도 쪽 레이아웃이 그 장 위 제자리에
    got = run_saved(browser, tmp_path, serve, text, """__deck.go(3); const z = document.querySelectorAll('section.slide')[3]
        .querySelector('.hsl-page'); const r = z.getBoundingClientRect(); const st = document.getElementById('stage').getBoundingClientRect();
        return [z.textContent, getComputedStyle(z.parentElement).position, Math.round((st.right - r.right) / 0.5)];""")
    assert got == ["4", "absolute", 50]
    # 되돌리기 — 장 순서·새 장·적용·원래 쪽 번호 지우기를 거꾸로 걷으면 처음 덱 그대로
    ctx, page, errors2 = open_editor(browser, base, "builder", hub)
    assert page.evaluate("window.__hse.serialize()") == text   # 다시 열어 손대지 않고 저장해도 글자 하나 다르지 않다
    open_layout(page)
    assert page.is_checked("#pPageOn") and page.input_value("#pPageFmt") == "{n}"
    assert page.input_value("#pFootText") == "시험 학회 2026" and page.locator("#pLogos .p-logo").count() == 1
    page.click("#pClear")
    assert "걷었습니다" in page.inner_text("#pStatus") and frame(page).locator("[data-deck-layout]").count() == 0
    t2 = page.evaluate("window.__hse.serialize()")
    assert "deck-layout" not in t2 and "data:image/png" not in t2
    page.keyboard.press("Control+z")
    assert frame(page).locator("[data-deck-layout]").count() == 10      # 표지 1 + 세 장 × 3
    ctx.close()
    assert errors == [] and errors2 == []
    assert original != text


def test_page_layout_undo_redo_and_unapplied_changes_guard(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    original = page.evaluate("window.__hse.serialize()")
    open_layout(page)
    # 흐름 덱의 .pageno·.foot — 3개 장씩
    assert "3개 장" in page.inner_text("#pOldPage") and "3개 장" in page.inner_text("#pOldFoot")
    page.check("#pPageOn")
    page.select_option("#pPagePos", "tc")
    page.check("#pPageCover")
    # 닫으려 하면 적용하지 않은 바뀜을 한 번 알린다(Esc 도)
    page.click("#pClose")
    assert page.locator("#pageDlg").is_visible() and "적용하지 않은" in page.inner_text("#pStatus")
    page.click("#pApply")
    assert zones(page) == [[["tc", 0, "", "1 / 3"]], [["tc", 0, "", "2 / 3"]], [["tc", 0, "", "3 / 3"]]]
    page.keyboard.press("Escape")                          # 적용했으니 바로 닫힌다
    pw.expect(page.locator("#pageDlg")).to_be_hidden()
    # 흐름 덱의 장은 position 이 있는 판 — 자리 상자는 장 위 가운데 위
    r = frame(page).locator("section.slide").nth(0).locator("[data-deck-layout]").evaluate(
        "(z) => [getComputedStyle(z).position, getComputedStyle(z).justifyContent]")
    assert r == ["absolute", "center"]
    page.keyboard.press("Control+z")
    assert frame(page).locator("[data-deck-layout]").count() == 0
    page.keyboard.press("Control+y")
    assert frame(page).locator("[data-deck-layout]").count() == 3
    page.keyboard.press("Control+z")
    assert page.evaluate("window.__hse.serialize()") == original
    ctx.close()
    assert errors == []


def test_overlap_warning_names_the_deck_text(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    open_layout(page)
    page.fill("#pFootText", "겹치는 꼬리말")
    page.select_option("#pFootPos", "tl")
    page.fill("#pMx", "64")
    page.fill("#pMy", "40")                                # 소제목 ‘1. 서론’(64, 40) 자리
    page.click("#pApply")
    pw.expect(page.locator("#pStatus")).to_contain_text("겹칩니다")
    assert "1. 서론" in page.inner_text("#pStatus") and "꼬리말이" in page.inner_text("#pStatus")
    ctx.close()
    assert errors == []


TAMPERED = BUILDER.replace("</style></head>", """</style>
<style id="deck-layout-css">.hsl.hsl[data-deck-layout] .hsl-logo-ok{width:9px;height:9px;background-image:url("https://evil.example/x.png")}</style>
<script type="application/json" id="deck-layout">{"v":1,"mx":"40","my":-50,"font":"x;}*{color:red","page":{"on":true,"fmt":"{n}<img src=x>",
"pos":"zz","pt":9999,"color":"red;}body{display:none","cover":true,"start":"7"},"foot":{"on":true,"text":"꼬리\\u0007말 </style><b>",
"pos":"bl"},"logos":[{"id":"BAD ID","pos":"tr"},{"id":"ok","pos":"tl","h":20,"ratio":2}]}</script></head>""")


def test_tampered_layout_settings_are_checked_before_use(browser, tmp_path, serve):
    assert TAMPERED != BUILDER
    base, hub = deck_site(tmp_path, serve, "t", TAMPERED)
    ctx, page, errors = open_editor(browser, base, "t", hub)
    # 꼴이 틀린 값은 기본값으로 — 쪽 번호 모양·자리·크기, 시작 번호는 글이어도 숫자로, 그림이 없는(밖 주소) 로고는 뺀다
    z = zones(page)
    assert z[0] == [["br", 0, "", "7 / 9"]]                # 꼬리말은 ‘표지에도’가 없어(기본 끔) 표지에 없다
    assert z[1] == [["bl", 0, "꼬리말 </style><b>", ""], ["br", 0, "", "8 / 9"]]   # 보이지 않는 글자(BEL)는 뺀다
    open_layout(page)
    assert (page.input_value("#pPageFmt"), page.input_value("#pPagePos"), page.input_value("#pPagePt")) == ("{n} / {N}", "br", "96")
    assert page.input_value("#pMy") == "0" and page.input_value("#pFont") == "" and page.locator("#pLogos .p-logo").count() == 0
    page.click("#pApply")
    css = frame(page).locator("#deck-layout-css").evaluate("(e) => e.textContent")
    for bad in ("display:none", "evil.example", "<img", "color:red", "</style"):
        assert bad not in css
    raw = frame(page).locator("#deck-layout").evaluate("(e) => e.textContent")
    assert "<" not in raw and json.loads(raw)["foot"]["text"] == "꼬리말 </style><b>"
    text = page.evaluate("window.__hse.serialize()")
    assert text.count("</style>") == BUILDER.count("</style>") + 1   # 꼬리말 글 속 '</style>' 이 덱을 깨지 않는다
    ctx.close()
    assert errors == []


@pytest.mark.parametrize("name", ["builder.html", "flow.html"])
def test_decks_without_layout_are_untouched(browser, decks, name):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, name[:-5], hub)
    text = page.evaluate("window.__hse.serialize()")
    assert same_dom(page, hub.saved(f"decks/{name}"), text) and "deck-layout" not in text
    ctx.close()
    assert errors == []


def test_flow_layout_text_is_not_editable_or_indexed(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    open_layout(page)
    page.fill("#pFootText", "학회꼬리말")
    page.click("#pApply")
    page.click("#pClose")
    foot = frame(page).locator("section.slide").nth(1).locator(".hsl-foot")
    page.keyboard.press("PageDown")
    assert foot.get_attribute("contenteditable") is None   # 장에서 고치지 않는다(쪽 레이아웃 창에서)
    page.click("#tabFind")
    page.fill("#findQ", "학회꼬리말")
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    assert page.locator("#hits li").count() == 0
    ctx.close()
    assert errors == []


# ---------- 검토에서 나온 경우들

PAGE2_END = '2 / 3</p></div></div>\n</section>'
ZONE = '<div class="hsl hsl-br" data-deck-layout="br"><span class="hsl-page">2 / 3</span></div>'


def layout_deck(settings: str, zone: str = "", own: str = "") -> str:
    """BUILDER 에 쪽 레이아웃 설정 글(settings — 빈 글이면 설정 없음)과 둘째 장 끝의 자리 상자(zone)·덱 제 요소(own)를 넣은 덱."""
    assert BUILDER.count(PAGE2_END) == 1
    head = ('<style id="deck-layout-css">.hsl.hsl[data-deck-layout]{position:absolute}</style>'
            f'<script type="application/json" id="deck-layout">{settings}</script>') if settings else ""
    return (BUILDER.replace("</style></head>", f"</style>{head}</head>", 1)
            .replace(PAGE2_END, f"2 / 3</p></div></div>{zone}{own}\n</section>", 1))


@pytest.mark.parametrize("settings", ['{"v":1,', "{}", "[1,2]", '{"v":2,"page":{"on":true}}'])
def test_unreadable_layout_settings_leave_the_slides_alone(browser, tmp_path, serve, settings):
    text0 = layout_deck(settings, zone=ZONE)
    base, hub = deck_site(tmp_path, serve, "u", text0)
    ctx, page, errors = open_editor(browser, base, "u", hub)
    assert zones(page) == [[], [["br", 0, "", "2 / 3"]], []]   # 걷지도(깨진 JSON), 켜지도(‘{}’) 않는다
    assert same_dom(page, hub.saved("decks/u.html"), page.evaluate("window.__hse.serialize()"))
    open_layout(page)
    assert "읽지 못했습니다" in page.inner_text("#pStatus")
    ctx.close()
    assert errors == []


def test_layout_settings_without_a_field_keep_it_off(browser, tmp_path, serve):
    base, hub = deck_site(tmp_path, serve, "v", layout_deck('{"v":1}'))
    ctx, page, errors = open_editor(browser, base, "v", hub)
    assert zones(page) == [[], [], []]                     # 적히지 않은 쪽 번호는 켜지지 않는다
    ctx.close()
    assert errors == []


def test_deck_elements_that_use_the_zone_attribute_are_kept(browser, tmp_path, serve):
    own = '<p data-deck-layout="own" style="position:absolute;left:0;top:0">덱의 것</p>'
    base, hub = deck_site(tmp_path, serve, "o", layout_deck("", own=own))
    ctx, page, errors = open_editor(browser, base, "o", hub)
    assert same_dom(page, hub.saved("decks/o.html"), page.evaluate("window.__hse.serialize()"))
    open_layout(page)
    page.check("#pPageOn")
    page.click("#pApply")
    page.click("#pClose")
    assert frame(page).locator("section.slide").nth(1).locator(":scope > [data-deck-layout=own]").count() == 1
    assert "덱의 것" in page.evaluate("window.__hse.serialize()")
    ctx.close()
    assert errors == []


@pytest.mark.parametrize("font,kept", [('\\"Foo', False), ("x /* y", False), ("Foo */ z", False), ("'Foo\\\\'", False),
                                       ('\\"Noto Sans KR\\", sans-serif', True), ("맑은 고딕, sans-serif", True)])
def test_layout_font_names_are_checked(browser, tmp_path, serve, font, kept):
    base, hub = deck_site(tmp_path, serve, "w", layout_deck('{"v":1,"font":"%s","page":{"on":true}}' % font))
    ctx, page, errors = open_editor(browser, base, "w", hub)
    open_layout(page)
    assert (page.input_value("#pFont") != "") is kept
    page.check("#pFootOn")                                 # 적용할 바뀜 하나
    page.fill("#pFootText", "꼬리말")
    page.click("#pApply")
    css = frame(page).locator("#deck-layout-css").evaluate("(e) => e.textContent")
    # 주석은 머리의 설명 하나뿐이고(짝이 맞고), 중괄호도 짝이 맞는다
    assert ("font-family" in css) is kept and css.count("/*") == css.count("*/") == 1 and css.count("{") == css.count("}")
    ctx.close()
    assert errors == []


FLOW3 = FLOW.replace("<ul><li>하나</li><li>둘</li></ul>", "<ul><li>하나</li><li>둘</li><li>셋</li></ul>")


def test_list_items_notes_free_box_copies_and_table_cells(browser, tmp_path, serve):
    assert FLOW3 != FLOW
    base, hub = deck_site(tmp_path, serve, "f3", FLOW3)
    ctx, page, errors = open_editor(browser, base, "f3", hub)
    page.keyboard.press("PageDown")
    sec = frame(page).locator("section.slide").nth(1)
    # 목록 항목을 잇달아 지우면 하나씩(목록째가 아니라)
    sec.locator("li", has_text="둘").click()
    pw.expect(page.locator("#boxDel")).to_be_enabled()
    page.click("#boxDel")
    assert sec.locator("li").count() == 2
    page.click("#boxDel")
    assert sec.locator("li").count() == 1 and sec.locator("ul").count() == 1
    # 노트를 치다 바로 막대를 눌러도 되돌리기에 노트가 섞이지 않는다
    page.click("#notes")
    page.keyboard.type(" 더함")
    page.click("#txtBtn")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    assert page.input_value("#notes") == "둘째 노트" and sec.locator(":scope > [data-hs-box]").count() == 0
    # 흐름 덱 글상자를 글 칸으로 골라(상자 고르기를 푼 뒤) 복제해도 비켜 놓는다
    page.click("#txtBtn")
    page.keyboard.type("상자")
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    assert state(page)["box"] is None
    page.keyboard.press("Control+d")
    boxes = sec.locator(":scope > [data-hs-box]")
    pos = boxes.evaluate_all("(bs) => bs.map((b) => [b.style.left, b.style.top])")
    assert len(pos) == 2 and pos[0] != pos[1]
    # 표 칸은 지우거나 복제하지 않는다(행·열은 ‘표 ▾’에서)
    page.keyboard.press("Escape")
    page.keyboard.press("PageDown")
    caret(page, "section.slide:nth-of-type(3) td", "칸")
    page.wait_for_timeout(100)
    assert page.is_disabled("#boxDel") and page.is_disabled("#boxDup")
    page.keyboard.press("Control+d")
    assert frame(page).locator("section.slide").nth(2).locator("td").count() == 1
    ctx.close()
    assert errors == []


def test_new_builder_text_boxes_get_their_own_names(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    page.click("#txtBtn")
    page.keyboard.press("Escape")
    page.click("#txtBtn")
    names = frame(page).locator("section.slide").nth(1).locator(":scope > [data-name^=text-]").evaluate_all(
        "(es) => es.map((e) => e.getAttribute('data-name'))")
    assert len(names) == 2 and len(set(names)) == 2       # ‘모든 장에’의 같은 이름 상자로 묶이지 않게
    ctx.close()
    assert errors == []
