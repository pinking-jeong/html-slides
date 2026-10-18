"""덱 편집기 — PowerPoint ‘홈’ 탭에서 더한 것: 위·아래 첨자·대/소문자·크게·작게·줄 간격·맞춤 단축키(textops.js), 회전·대칭
(배치 ▾ · Alt+←/→), 돌린 상자의 틀·손잡이·맞추기, 도형·선 넣기와 채우기·윤곽선(shapes.js), PPTX 받기의 회전·대칭·도형·선,
저장·다시 빌드한 덱에 다시 입히기(deckmerge), 복사·붙여 넣기의 돌림·대칭·선(deckclip.js). 브라우저(Playwright)로 눌러 보고,
저장은 DeckHub 에서 본다(시험 틀은 test_editor.py)."""
import json
import re

import pytest

import deckmerge as dm
from test_editor import (  # noqa: F401 — browser·serve 는 fixture
    BUILDER, FLOW, DeckHub, browser, caret, drag, frame, make_site, open_editor, same_dom, save_with_token, select_text,
    serve, state, wait_saved,
)
from test_editor_arrange import ARR, at, click_box, geo, menu, order, slide2  # noqa: F401
from test_editor_clip import item, open_also, paste_crafted, received
from test_editor_pptx import shapes as sps, slides, take, texts

BODY = "section.slide:nth-of-type(2) [data-name=body] .tin"
# 둘째 장 본문 첫 문단에 로마자 — 대/소문자 바꾸기
PPT = BUILDER.replace(">첫 문단<", ">첫 문단 deck tools<")
# 둘째 장에 그림 상자 하나(700, 420 200×100) — 복사·붙여 넣기의 돌림
PNG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mNk+M9QzwAEjDAGACCDAv8cI7IoAAAAAElFTkSu"
       "QmCC")
PIC = BUILDER.replace('<svg class="el"', f'<img class="el" data-name="pic" src="{PNG}" alt="그림" '
                      'style="left:700px;top:420px;width:200px;height:100px"><svg class="el"', 1)


@pytest.fixture
def ppt(tmp_path, serve):
    names = {"ppt.html": PPT, "flow.html": FLOW, "arr.html": ARR, "pic.html": PIC}
    site, root = make_site(tmp_path, names)
    hub = DeckHub({f"decks/{n}": (root / "decks" / n).read_bytes() for n in names})
    return serve(site), hub


def open_deck(browser, ppt, name: str, page_down: bool = True):
    base, hub = ppt
    ctx, page, errors = open_editor(browser, base, name, hub)
    if page_down:
        page.keyboard.press("PageDown")
    return ctx, page, errors, hub


def html_of(loc) -> str:
    return loc.evaluate("(e) => e.innerHTML")


def pressed(page, id_: str) -> bool:
    return page.get_attribute(f"#{id_}", "aria-pressed") == "true"


# ---------- 글자: 위·아래 첨자 · 대/소문자 · 크게·작게

def test_scripts_case_and_size_steps_on_the_chosen_text(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "ppt")
    p = slide2(page).locator("[data-name=body] .tin p").first
    p.click()
    assert select_text(page, BODY, "문단") == "문단"
    page.click("#fSup")                                    # 위 첨자 — 고른 글만, 막대에 눌림
    assert html_of(p) == "첫 <sup>문단</sup> deck tools" and pressed(page, "fSup") and not pressed(page, "fSub")
    assert frame(page).locator("body").evaluate("(b) => b.ownerDocument.getSelection().toString()") == "문단"
    page.keyboard.press("Control+Equal")                   # 아래 첨자(Ctrl+=) — 위 첨자는 걷힌다
    assert html_of(p) == "첫 <sub>문단</sub> deck tools" and pressed(page, "fSub") and not pressed(page, "fSup")
    page.keyboard.press("Control+Shift+Equal")             # 위 첨자(Ctrl+Shift++)
    assert html_of(p) == "첫 <sup>문단</sup> deck tools"
    page.keyboard.press("Control+Shift+Equal")             # 한 번 더 — 끈다
    assert html_of(p) == "첫 문단 deck tools" and not pressed(page, "fSup")
    # 대/소문자 바꾸기(Shift+F3) — 소문자 → 단어 첫 글자 대문자 → 대문자 → 소문자
    select_text(page, BODY, "deck tools")
    page.keyboard.press("Shift+F3")
    assert p.inner_text() == "첫 문단 Deck Tools"
    page.keyboard.press("Shift+F3")
    assert p.inner_text() == "첫 문단 DECK TOOLS"
    page.click("#fCase")
    assert p.inner_text() == "첫 문단 deck tools"
    assert frame(page).locator("body").evaluate("(b) => b.ownerDocument.getSelection().toString()") == "deck tools"
    # 크게·작게(Ctrl+Shift+> · <) — PowerPoint 크기 목록으로 고른 글만. 문단의 줄 높이(31.2px)는 그대로 두고 키운 글에 같은
    # 비율(1.3)의 줄 높이 — 큰 글이 든 줄만 넓어져 윗줄을 덮지 않는다(덱 공통 명령)
    select_text(page, BODY, "첫")
    page.keyboard.press("Control+Shift+Period")
    assert re.search(r"<span style=\"font-size: 26\.67px; line-height: 1\.3;\">첫</span>", html_of(p)), html_of(p)
    assert p.evaluate("(e) => e.style.lineHeight") == "31.2px"
    assert page.input_value("#fSize") == "20"
    page.keyboard.press("Control+Shift+Period")            # 20pt 다음은 24pt(목록의 다음 크기)
    assert "font-size: 32px" in html_of(p) and page.input_value("#fSize") == "24"
    assert p.evaluate("(e) => e.offsetHeight") >= 41       # 32px × 1.3 = 41.6px 줄(문단 줄 높이 31.2px 보다 넓게)
    page.keyboard.press("Control+Shift+Comma")
    assert "font-size: 26.67px" in html_of(p)
    assert state(page)["undo"] == 10                       # 한 번이 되돌리기 한 칸
    for _ in range(10):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/ppt.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


def test_mixed_sizes_grow_each_and_whole_boxes_take_spacing_and_align_keys(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "ppt")
    s2 = slide2(page)
    body = s2.locator("[data-name=body] .tin p")
    title = s2.locator("[data-name=title] .tin p")
    body.first.click()
    click_box(page, "title", "Shift")                      # 글상자 둘 — 글 고르기는 풀리고 두 상자의 글 모두에
    assert state(page)["sel"] == 2
    page.keyboard.press("Control+Shift+Period")            # 크기가 다른 글(24px·40px)도 글마다 한 단계
    sizes = [e.evaluate("(e) => getComputedStyle(e.querySelector('span') || e).fontSize") for e in (body.first, title)]
    assert sizes == ["26.67px", "42.67px"], sizes          # 18pt → 20pt, 30pt → 32pt
    page.select_option("#fSpacing", "1.5")                 # 줄 간격 1.5 = 글자 크기의 1.8배(단위 없는 줄 높이)
    lh = [body.nth(i).evaluate("(e) => e.style.lineHeight") for i in range(2)] + [title.evaluate("(e) => e.style.lineHeight")]
    assert lh == ["1.8", "1.8", "1.8"]
    assert page.input_value("#fSpacing") == "1.5"
    page.keyboard.press("Control+e")                       # 맞춤 단축키(Ctrl+L·E·R·J) — 서식 막대의 맞춤과 같다
    assert {body.nth(i).evaluate("(e) => e.style.textAlign") for i in range(2)} == {"center"} and pressed(page, "fCenter")
    page.keyboard.press("Control+r")
    assert title.evaluate("(e) => e.style.textAlign") == "right"
    page.keyboard.press("Control+j")
    page.keyboard.press("Control+l")
    assert title.evaluate("(e) => e.style.textAlign") == "left" and state(page)["undo"] == 6
    page.keyboard.press("Escape")                          # 고른 것이 없으면 브라우저의 키 그대로 — 편집기는 쓰지 않는다
    page.keyboard.press("Control+e")
    assert state(page)["undo"] == 6
    for _ in range(6):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/ppt.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


# ---------- 회전 · 대칭

def turn(page, name: str) -> list:
    """둘째 장 상자의 [rotate, scale](style 의 값 — 없으면 '')."""
    return slide2(page).locator(f":scope > [data-name={name}]").evaluate("(e) => [e.style.rotate, e.style.scale]")


def test_rotate_and_flip_each_chosen_box_by_menu_and_alt_arrows(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "arr")
    click_box(page, "a")
    click_box(page, "b", "Shift")
    page.keyboard.press("Alt+ArrowRight")                  # 고른 상자마다 제 가운데를 두고 15°
    assert turn(page, "a") == ["15deg", ""] and turn(page, "b") == ["15deg", ""]
    assert geo(page, "a") == [100, 100, 100, 50] and geo(page, "b") == [300, 200, 200, 50]
    assert state(page)["cur"] == 1                         # 장은 넘어가지 않았다
    menu(page, "arr", "turn:90")
    assert turn(page, "a") == ["105deg", ""] and turn(page, "b") == ["105deg", ""]
    page.keyboard.press("Alt+ArrowLeft")
    page.keyboard.press("Alt+ArrowLeft")
    assert turn(page, "a") == ["75deg", ""]
    menu(page, "arr", "turn:-90")
    assert turn(page, "a") == ["-15deg", ""]
    menu(page, "arr", "turn:0")                            # 회전 없애기
    assert turn(page, "a") == ["", ""] and turn(page, "b") == ["", ""]
    menu(page, "arr", "flip:h")
    assert turn(page, "a")[1] == "-1 1" and turn(page, "b")[1] == "-1 1"
    menu(page, "arr", "flip:v")                            # 좌우·상하 모두 — 브라우저는 '-1 -1' 을 '-1' 로 적는다
    assert turn(page, "a")[1] in ("-1", "-1 -1")
    menu(page, "arr", "flip:h")
    assert turn(page, "a")[1] == "1 -1"
    assert state(page)["undo"] == 9                        # 하나하나가 되돌리기 한 칸
    # 글이 든 상자는 돌리되 뒤집지 않는다 — 메뉴의 대칭이 꺼진다
    page.keyboard.press("Escape")
    click_box(page, "title")
    page.click("#arrBtn")
    assert page.is_disabled("#arrMenu [data-act='flip:h']") and page.is_enabled("#arrMenu [data-act='turn:90']")
    assert page.is_disabled("#arrMenu [data-act='turn:0']")       # 돌린 것이 없으면 회전 없애기도 꺼진다
    page.click("#arrMenu [data-act='turn:90']")
    assert turn(page, "title") == ["90deg", ""]
    # 잠근 상자는 돌리지 않는다(고른 채로)
    menu(page, "arr", "lock")
    page.keyboard.press("Alt+ArrowRight")
    assert turn(page, "title") == ["90deg", ""] and "잠근 상자는 돌리지 않습니다" in page.inner_text("#status")
    # 글을 쓰는 중의 Alt+← 는 상자를 돌리지 않는다 — Mac 이 아니면 브라우저의 ‘뒤로’도 막는다(고치던 덱을 떠나지 않게)
    undo = state(page)["undo"]
    # 편집기가 덱 문서의 키를 덱 스크립트보다 먼저 받아 멈추므로 막았는지는 preventDefault 를 불렀는지로 본다
    frame(page).locator("body").evaluate("""(b) => { const w = b.ownerDocument.defaultView, k = w.KeyboardEvent.prototype;
        const pd = k.preventDefault; k.preventDefault = function () { if (this.altKey) w.__alt = true; return pd.call(this); }; }""")
    page.keyboard.press("Escape")
    slide2(page).locator("[data-name=body] .tin p").first.click(position={"x": 10, "y": 10})   # 돌린 제목에 덮이지 않은 곳
    caret(page, BODY, "첫 문단", 1)
    page.keyboard.press("Alt+ArrowLeft")
    mac = page.evaluate("() => /Mac|iP(hone|ad|od)/.test(navigator.platform)")
    assert frame(page).locator("body").evaluate("(b) => !!b.ownerDocument.defaultView.__alt") is (not mac)
    assert state(page)["undo"] == undo and turn(page, "body") == ["", ""]
    for _ in range(state(page)["undo"]):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/arr.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


# 표는 돌리지도 뒤집지도 꾸미지도 않는다 — PPTX 의 표는 돌지 않는다(덱 공통 편집기들과 같은 규칙)
def test_tables_are_not_turned_flipped_or_outlined(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "arr")
    page.keyboard.press("PageDown")                        # 셋째 장의 표
    tbl = frame(page).locator("section.slide").nth(2).locator(":scope > table.el")
    tbl.locator("td").first.click()
    page.keyboard.press("Escape")                          # 글 고치기를 마치고 표를 고른 채
    assert state(page)["sel"] == 1 and page.is_disabled("#fillBtn") and page.is_disabled("#lineBtn")
    page.click("#arrBtn")
    assert page.is_disabled("#arrMenu [data-act='turn:90']") and page.is_disabled("#arrMenu [data-act='flip:h']")
    page.keyboard.press("Escape")
    page.keyboard.press("Alt+ArrowRight")
    assert tbl.evaluate("(e) => e.style.rotate") == "" and "표·시연 화면은 돌리지 않습니다" in page.inner_text("#status")
    assert state(page)["undo"] == 0
    ctx.close()
    assert errors == []


# Ctrl+Shift+] · [ 는 PowerPoint(Windows) 단축키 표처럼 한 칸 앞으로 · 뒤로(맨 앞·맨 뒤는 단축키 없이 ‘배치 ▾’에서)
def test_ctrl_shift_brackets_move_one_step_like_powerpoint(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "arr")
    names = lambda: [n for n in order(page) if n in ("a", "b", "c")]  # noqa: E731
    click_box(page, "a")
    page.keyboard.press("Control+Shift+BracketRight")
    assert names() == ["b", "a", "c"]
    page.keyboard.press("Control+Shift+BracketRight")
    assert names() == ["b", "c", "a"]
    page.keyboard.press("Control+Shift+BracketLeft")
    assert names() == ["b", "a", "c"] and state(page)["undo"] == 3
    ctx.close()
    assert errors == []


def test_rotated_box_frame_handles_resize_and_align_by_its_visible_edges(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "arr")
    click_box(page, "b")                                   # b: 300,200 200×50
    menu(page, "arr", "turn:90")
    pick = page.locator(".pick")
    assert pick.evaluate("(e) => e.style.rotate") == "90deg"     # 틀도 함께 돈다(크기 글은 바로 선다)
    assert page.locator(".pick-badge").evaluate("(e) => e.style.rotate") == "-90deg"
    s = state(page)["scale"]
    fb = page.locator("#frame").bounding_box()
    bb = pick.bounding_box()                               # 돈 틀이 보이는 자리 — 세로로 선 50×200
    assert abs(bb["width"] - 50 * s) < 2 and abs(bb["height"] - 200 * s) < 2
    assert abs(bb["x"] - (fb["x"] + 375 * s)) < 2 and abs(bb["y"] - (fb["y"] + 125 * s)) < 2
    menu(page, "arr", "align:left")                        # 하나는 장에 — 보이는 왼쪽 끝(375)을 0 에
    assert geo(page, "b") == [-75, 200, 200, 50]
    menu(page, "arr", "align:top")                         # 보이는 위 끝(125)을 0 에
    assert geo(page, "b") == [-75, 75, 200, 50]
    # 오른쪽 손잡이(돈 틀에서는 아래에 보인다)를 아래로 40 — 상자의 가로가 40 늘고 반대쪽(보이는 위 끝)은 제자리
    drag(page, ".pick-h.e", 0, 40 * s)
    assert geo(page, "b") == [-95, 95, 240, 50]
    seen = slide2(page).locator(":scope > [data-name=b]").evaluate(
        "(e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }")
    assert seen == [0, 0, 50, 240], seen
    assert state(page)["undo"] == 4
    for _ in range(4):
        page.keyboard.press("Control+z")
    assert geo(page, "b") == [300, 200, 200, 50] and turn(page, "b") == ["", ""]
    ctx.close()
    assert errors == []


# ---------- 도형 넣기 · 채우기 · 윤곽선

def newest(page, sel: str):
    return slide2(page).locator(f":scope > {sel}").last


def box_look(loc) -> dict:
    return loc.evaluate("""(e) => { const c = getComputedStyle(e);
        return { bg: c.backgroundColor, bw: e.style.borderTopWidth || c.borderTopWidth, bs: c.borderTopStyle, bc: c.borderTopColor,
                 radius: e.style.borderRadius }; }""")


def test_builder_shapes_lines_fill_and_outline(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "ppt")
    assert page.is_disabled("#fillBtn") and page.is_disabled("#lineBtn")    # 고른 상자가 없으면 꺼져 있다
    # 덱이 그린 SVG(화살표 도표)는 채우지도 윤곽선을 긋지도 않는다 — 둘레에 CSS 테두리 상자가 생긴다(덱 공통 편집기들과 같게)
    slide2(page).locator(":scope > svg.el").first.click()
    assert state(page)["sel"] == 1 and page.is_disabled("#fillBtn") and page.is_disabled("#lineBtn")
    page.keyboard.press("Escape")
    menu(page, "shape", "shape:rect")                      # 사각형 — 채운 글상자(덱의 상자 꼴), 장 가운데에 넣고 고른다
    rect = newest(page, ".el.tx")
    assert rect.get_attribute("data-name").startswith("shape-")
    assert state(page)["box"] == {"x": 540, "y": 300, "w": 200, "h": 120} and state(page)["sel"] == 1
    got = box_look(rect)
    assert got["bg"] == "rgb(68, 114, 196)" and got["bw"] == "1.5px" and got["bs"] == "solid" and got["bc"] == "rgb(47, 82, 143)"
    assert rect.locator(".tin p.pp").evaluate("(e) => [getComputedStyle(e).color, e.style.textAlign]") == ["rgb(255, 255, 255)", "center"]
    assert page.is_enabled("#fillBtn") and page.is_enabled("#lineBtn")
    menu(page, "fill", "fill:#C00000")
    assert box_look(rect)["bg"] == "rgb(192, 0, 0)"
    menu(page, "fill", "alpha:0.5")                        # 투명도 50%
    assert box_look(rect)["bg"] == "rgba(192, 0, 0, 0.5)"
    page.click("#fillBtn")                                 # 메뉴에 지금 값이 보인다
    assert page.get_attribute("#fillMenu [data-act='fill:#C00000']", "class") == "on"
    assert "on" in page.get_attribute("#fillMenu [data-act='alpha:0.5']", "class")
    page.keyboard.press("Escape")
    menu(page, "line", "line:none")
    assert box_look(rect)["bs"] == "none"
    menu(page, "line", "lineW:4")                          # 두께를 고르면 윤곽선이 다시 생긴다(기본 색으로)
    got = box_look(rect)
    assert got["bw"] == "4px" and got["bs"] == "solid" and got["bc"] == "rgb(47, 82, 143)"
    menu(page, "line", "dash:dashed")
    assert box_look(rect)["bs"] == "dashed"
    page.click("#fillBtn")                                 # 다른 색… — 색 고르기 창(고르면 change 로 한 번)
    page.click("#fillMenu [data-act='fill:pick']")
    page.locator("#fillPick").evaluate("(e) => { e.value = '#00b050'; e.dispatchEvent(new Event('change')); }")
    assert box_look(rect)["bg"] == "rgba(0, 176, 80, 0.5)"         # 투명도는 그대로
    # 글을 쓴다 — 도형 가운데를 누르면
    rect.locator(".tin p").click()
    page.keyboard.type("가나")
    assert rect.locator(".tin p").inner_text() == "가나"
    page.keyboard.press("Escape")
    # 타원·화살표
    menu(page, "shape", "shape:oval")
    oval = newest(page, ".el.tx")
    assert box_look(oval)["radius"] == "50%" and state(page)["box"]["x"] == 556       # 같은 자리에 있으면 비켜 놓는다
    menu(page, "shape", "shape:arrow")
    arrow = newest(page, "svg.el")
    assert arrow.get_attribute("data-name") == "deckops:arrow" and arrow.locator("polygon").count() == 1
    assert state(page)["box"] == {"x": 520, "y": 348, "w": 240, "h": 24}
    assert page.is_disabled("#fillBtn") and page.is_enabled("#lineBtn")             # 선은 채우지 않는다
    s = state(page)["scale"]
    drag(page, ".pick-h.e", 60 * s, 0)                     # 길이를 바꾸면 다시 그린다(화살촉이 찌그러지지 않게)
    assert state(page)["box"]["w"] == 300 and arrow.get_attribute("viewBox") == "0 0 300 24"
    menu(page, "line", "line:#C00000")
    menu(page, "line", "lineW:3")
    menu(page, "line", "dash:dotted")
    line = arrow.locator("line")
    assert [line.get_attribute(k) for k in ("stroke", "stroke-width", "stroke-dasharray")] == ["#C00000", "3", "1.5 3"]
    assert arrow.locator("polygon").get_attribute("fill") == "#C00000"
    menu(page, "line", "line:none")                        # 선은 윤곽선을 없애지 않는다 — 그대로 두고 왜인지 알린다
    assert line.get_attribute("stroke") == "#C00000" and "‘윤곽선 없음’을 쓰지 않습니다" in page.inner_text("#status")
    # 선은 글이 없는 상자 — 대칭할 수 있다
    menu(page, "arr", "flip:h")
    assert arrow.evaluate("(e) => e.style.scale") == "-1 1"
    n = state(page)["undo"]
    assert n == 15, n                                       # 넣기·서식·글 하나하나가 한 칸
    for _ in range(n):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/ppt.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


def test_flow_shapes_are_free_boxes_and_lines_move_by_dragging(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "flow", page_down=False)
    s1 = frame(page).locator("section.slide").first
    menu(page, "shape", "shape:round")
    box = s1.locator(":scope > [data-hs-box]").last
    assert box.evaluate("(e) => [e.localName, e.style.position, e.style.borderRadius]") == ["div", "absolute", "20px"]
    assert state(page)["box"] == {"x": 540, "y": 300, "w": 200, "h": 120}
    assert box.evaluate("(e) => e.getBoundingClientRect().width") == 200     # 테두리·안쪽 여백까지 상자 크기 안에
    box.locator("p").click()                               # 상자째 한 글 칸
    page.keyboard.type("흐름")
    assert box.inner_text().strip() == "흐름"
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    menu(page, "shape", "shape:line")
    line = s1.locator(":scope > svg[data-hs-box]")
    assert line.count() == 1 and line.get_attribute("contenteditable") is None      # 선은 글 칸이 아니다
    s = state(page)["scale"]
    x, y = at(page, 640, 360)
    page.mouse.move(x, y)                                  # 글이 없는 상자는 누른 채로 끌어 옮긴다
    page.mouse.down()
    page.mouse.move(x + 40 * s, y + 100 * s, steps=6)     # 맞춤선에 붙지 않는 곳으로
    page.mouse.up()
    g = state(page)["box"]
    assert (g["x"], g["y"]) == (560, 448), g
    menu(page, "arr", "flip:v")                            # 글이 없으니 대칭도
    assert line.evaluate("(e) => e.style.scale") == "1 -1"
    save_with_token(page)
    wait_saved(page, hub)
    saved = hub.saved("decks/flow.html")
    assert saved.count("data-hs-box") == 2 and 'data-name="deckops:line"' in saved and "contenteditable" not in saved
    ctx.close()
    assert errors == []


# ---------- PPTX 받기 — 회전·대칭·도형·선

def xfrm(sp: str) -> str:
    m = re.search(r"<a:xfrm[^>]*>", sp)
    return m.group(0) if m else ""


def ext(sp: str) -> tuple:
    """도형의 크기(px — 1px = 9525 EMU)"""
    m = re.search(r'<a:ext cx="(\d+)" cy="(\d+)"/>', sp)
    return round(int(m.group(1)) / 9525, 1), round(int(m.group(2)) / 9525, 1)


def test_pptx_keeps_rotation_flips_shapes_and_lines(browser, ppt, tmp_path):
    ctx, page, errors, hub = open_deck(browser, ppt, "ppt")
    click_box(page, "title")                               # 글상자를 90° — 글도 함께 돈다
    menu(page, "arr", "turn:90")
    page.keyboard.press("Escape")
    slide2(page).locator(":scope > svg.el").first.click()  # 덱의 도표(SVG) — 좌우 대칭은 그림의 flipH 로
    menu(page, "arr", "flip:h")
    for kind in ("rect", "round", "oval"):
        menu(page, "shape", f"shape:{kind}")
    menu(page, "shape", "shape:arrow")
    page.keyboard.press("Alt+ArrowRight")                  # 화살표를 15°
    menu(page, "line", "dash:dashed")
    name, z = take(page, tmp_path)
    s2 = slides(z)[1]
    sp = sps(s2)
    title = next(x for x in sp if "둘째 장 제목" in x)
    assert 'rot="5400000"' in xfrm(title), xfrm(title)
    geoms = re.findall(r'<a:prstGeom prst="(\w+)">', s2)
    assert {"rect", "roundRect", "ellipse"} <= set(geoms), geoms
    oval = [x for x in sp if 'prst="ellipse"' in x]       # 200×120 타원 — 둥근 사각형(알약)이 아니라 타원
    assert oval and ext(oval[0]) == (200, 120), ext(oval[0])
    line = next(x for x in sp if 'prst="line"' in x)       # 화살표는 그림이 아니라 선 — 화살촉·대시·회전까지
    assert '<a:tailEnd type="triangle"/>' in line and 'prstDash val="dash"' in line and 'rot="900000"' in xfrm(line), line
    assert 'cy="0"' in line and 'val="4472C4"' in line
    pics = re.findall(r"<p:pic>.*?</p:pic>", s2, re.S)
    assert len(pics) == 1 and 'flipH="1"' in pics[0], pics   # 화살표는 더 이상 그림이 아니다 — 그림은 도표 하나
    ctx.close()
    assert errors == []


# ---------- 저장 · 다시 빌드한 덱에 다시 입히기(slides sync — deckmerge)

def test_rotation_flips_scripts_and_new_shapes_survive_a_rebuild(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "arr")
    first = hub.files["decks/arr.html"]
    click_box(page, "a")
    menu(page, "arr", "turn:90")
    click_box(page, "c")
    menu(page, "arr", "flip:h")
    page.keyboard.press("Escape")
    menu(page, "shape", "shape:rect")
    menu(page, "shape", "shape:arrow")
    page.keyboard.press("Escape")
    slide2(page).locator("[data-name=body] .tin p").first.click()
    select_text(page, BODY, "문단")
    page.keyboard.press("Control+Shift+Equal")             # 위 첨자
    page.keyboard.press("Escape")
    save_with_token(page)
    wait_saved(page, hub)
    saved = hub.files["decks/arr.html"]
    # 빌더가 둘째 장 제목을 바꿔 다시 빌드 — 편집기의 회전·대칭·첨자·새 도형은 새 빌드에 다시 들어간다
    rebuilt = first.replace("둘째 장 제목".encode(), "빌더가 바꾼 둘째 제목".encode())
    r = dm.reapply(first, saved, rebuilt)
    assert r.text and not r.refused and r.kept == [], (r.refused, r.kept)
    out = dm.Doc(dm.read_edits(r.text.removeprefix(dm.BOM))[1]).by_key["s02"]
    boxes = {(n.get("data-name") or n.tag): n for _, n in dm.boxes(out)}
    assert "빌더가 바꾼 둘째 제목" in dm.text_content(boxes["title"])
    assert "rotate: 90deg" in boxes["a"].get("style") and "scale: -1 1" in boxes["c"].get("style")
    assert "deckops:arrow" in boxes and any(k.startswith("shape-") for k in boxes)
    body = r.text[r.text.index('data-name="body"'):]
    assert "<sup>문단</sup>" in body[:body.index("</div></div>")]
    ctx.close()
    assert errors == []


# ---------- 서식 복사(선 서식) · 모든 장에(선은 이름이 아니라 꼴로)

def test_format_painter_carries_line_format_and_master_does_not_merge_lines_by_name(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "ppt")
    lines = slide2(page).locator(":scope > svg.el")        # 0 은 덱의 도표
    menu(page, "shape", "shape:arrow")                     # 선 A — 빨강·3pt(위로 비켜 놓는다)
    a = lines.nth(1)
    menu(page, "line", "line:#C00000")
    menu(page, "line", "lineW:4")
    for _ in range(20):
        page.keyboard.press("Shift+ArrowUp")
    page.keyboard.press("Escape")
    menu(page, "shape", "shape:line")                      # 선 B — 기본(아래로)
    b = lines.nth(2)
    for _ in range(20):
        page.keyboard.press("Shift+ArrowDown")
    page.keyboard.press("Escape")
    menu(page, "shape", "shape:rect")                      # 사각형 R
    rect = newest(page, ".el.tx")
    page.keyboard.press("Escape")
    a.click()
    page.click("#fPaint")
    page.dblclick("#fPaint")                               # 여러 번
    b.click()                                              # 선 → 선: 선 서식
    page.wait_for_timeout(100)                             # 붓은 포인터를 뗀 다음 차례에 입힌다
    assert [b.locator("line").get_attribute(k) for k in ("stroke", "stroke-width")] == ["#C00000", "4"]
    rect.click(position={"x": 4, "y": 4})                  # 선 → 상자: 그 선을 윤곽선으로(채우기는 그대로)
    page.wait_for_timeout(100)
    got = box_look(rect)
    assert got["bc"] == "rgb(192, 0, 0)" and got["bw"] == "4px" and got["bg"] == "rgb(68, 114, 196)"
    page.keyboard.press("Escape")
    # 덱이 그린 화살표 도표(SVG)에는 상자 모양을 입히지 않는다 — 둘레에 테두리 상자가 생긴다(덱 공통 편집기들과 같게)
    chart = lines.nth(0)
    was = chart.get_attribute("style")
    rect.click(position={"x": 4, "y": 4})
    page.click("#fPaint")
    chart.click()
    page.wait_for_timeout(100)
    assert chart.get_attribute("style") == was
    page.keyboard.press("Escape")
    # 모든 장에 — 덱 공통 편집 명령이 화살표마다 다는 이름(deckops:arrow)은 상자 이름이 아니다: 색이 다른 화살표 C 는 A 와
    # 같은 상자가 아니다(이름으로 찾으면 같은 상자 1개 — 모든 장에서 지우기가 C 까지 지운다)
    menu(page, "shape", "shape:arrow")
    assert lines.count() == 4 and lines.nth(3).get_attribute("data-name") == a.get_attribute("data-name") == "deckops:arrow"
    page.keyboard.press("Escape")
    a.click()
    page.click("#masterBtn")
    assert "같은 상자 0개" in page.inner_text("#mBoxHelp") and "deckops" not in page.inner_text("#mBoxHelp")
    ctx.close()
    assert errors == []


def test_format_painter_moves_the_look_but_not_the_shape(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "ppt")
    menu(page, "shape", "shape:rect")                      # 사각형 R(540, 300) — 이름으로 붙든다(.last 는 다음 도형으로 간다)
    rect = slide2(page).locator(f':scope > [data-name="{newest(page, ".el.tx").get_attribute("data-name")}"]')
    page.keyboard.press("Escape")
    menu(page, "shape", "shape:oval")                      # 타원 O — 비켜 놓이고 고른 채로, 빨강·3pt 윤곽선
    oval = newest(page, ".el.tx")
    menu(page, "fill", "fill:#C00000")
    menu(page, "line", "lineW:4")
    assert state(page)["sel"] == 1 and state(page)["box"]["x"] == 556
    page.click("#fPaint")                                  # 타원의 서식을 집어 사각형에
    rect.click(position={"x": 4, "y": 4})
    page.wait_for_timeout(100)                             # 붓은 포인터를 뗀 다음 차례에 입힌다
    # 채우기·윤곽선은 오고 꼴(둥근 모서리)은 그대로 — 타원의 서식을 입혀도 사각형(PowerPoint·덱 공통 편집기들과 같게)
    got = box_look(rect)
    assert got["bg"] == "rgb(192, 0, 0)" and got["bw"] == "4px" and got["radius"] == "0px", got
    assert box_look(oval)["radius"] == "50%"
    assert state(page)["undo"] == 5                        # 넣기 둘·채우기·윤곽선·입히기
    for _ in range(5):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/ppt.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


# ---------- 복사·붙여 넣기 — 돌림·대칭·선째(덱 공통 클립보드)

def copied(ctx, page) -> dict:
    """고른 상자를 Ctrl+C 로 복사한 페이로드(창 없는 브라우저 안의 클립보드에서 받아 본 것)."""
    page.bring_to_front()
    page.keyboard.press("Control+c")
    return json.loads(received(ctx)["mime"])


def test_copy_paste_keeps_rotation_flips_and_lines(browser, ppt):
    ctx, page, errors, hub = open_deck(browser, ppt, "pic")
    slide2(page).locator(":scope > img.el").click()
    page.keyboard.press("Alt+ArrowRight")
    page.wait_for_timeout(600)                             # 15° 의 그림을 준비한 뒤에
    page.keyboard.press("Alt+ArrowRight")                  # 30° — 고른 상자를 돌리면 다른 프로그램용 그림을 다시 준비한다(warm)
    menu(page, "arr", "flip:h")                            # 좌우로도 뒤집는다
    page.wait_for_timeout(600)
    # 페이로드 — 돌림·대칭 값과 돌리기 전 상자(A 는 box 를 넘기지 않는다 — 공통 모듈이 잰다), 돌림을 구운 그림(look)
    p = copied(ctx, page)
    it = p["items"][0]
    assert it["type"] == "image" and it["rot"] == 30 and it["flip"] == "h" and it.get("look")
    assert (it["x"], it["y"], it["w"], it["h"]) == (700, 420, 200, 100)
    # 같은 덱의 셋째 장 — 같은 꼴 그대로(native), 돌림·대칭째 같은 자리·크기
    page.keyboard.press("PageDown")
    page.keyboard.press("Escape")
    page.keyboard.press("Control+v")
    s3 = frame(page).locator("section.slide").nth(2)
    look = "(e) => [e.style.rotate, e.style.scale, e.style.left, e.style.top, e.style.width, e.style.height]"
    want = ["30deg", "-1 1", "700px", "420px", "200px", "100px"]
    assert s3.locator(":scope > img.el").evaluate(look) == want
    # 다른 편집기에서 온 것처럼 native 를 뺀 같은 페이로드 — 혼자 서는 꼴에서 만든 그림(toBuilder)에도 돌림·대칭이 남는다
    # (A 의 거르기가 style 의 rotate·scale 을 지나 보낸다). 같은 자리에 이미 있어 16px 비켜서
    for x in p["items"]:
        x.pop("native", None)
    p["id"], p["src"] = "other1", {"editor": "x", "title": "x", "session": "zz"}
    paste_crafted(page, p)
    assert s3.locator(":scope > img.el").nth(1).evaluate(look) == ["30deg", "-1 1", "716px", "436px", "200px", "100px"]
    # 흐름 덱 — 옮길 수 있는 그림(img[data-hs-box])으로, 돌림째
    flow, errors2 = open_also(ctx, ppt[0], "flow")
    flow.bring_to_front()
    flow.keyboard.press("PageDown")
    flow.keyboard.press("Escape")
    flow.keyboard.press("Control+v")
    f2 = flow.frame_locator("#frame").locator("section.slide").nth(1)
    assert f2.locator(":scope > img[data-hs-box]").evaluate(look) == want
    # 다른 편집기가 보낸 돌리고 뒤집은 글상자는 돌림만(글이 거울에 비쳐 보이지 않게 — 빌더 덱과 같은 규칙), 표는 그대로
    paste_crafted(flow, {"app": "deckclip", "v": 2, "id": "turn1", "src": {"editor": "x", "title": "x", "session": "zz"},
                         "stage": {"w": 1280, "h": 720}, "blobs": {}, "text": "x", "t": 0,
                         "items": [item(type="text", html="<p>돌린 글</p>", rot=15, flip="h"),
                                   item(type="table", y=300, html="<table><tr><td>칸</td></tr></table>", rot=15)]})
    got = f2.locator(":scope > div[data-hs-box]").evaluate_all(
        "(es) => es.slice(-2).map((e) => [e.textContent, e.style.rotate, e.style.scale])")
    assert got == [["돌린 글", "15deg", ""], ["칸", "", ""]], got
    # 좌우로 뒤집은 빨간 화살표 — 흐름 덱에도 선(svg[data-hs-box] + 선 이름표)으로, 대칭째. 선 색은 선의 속성 그대로
    page.bring_to_front()
    menu(page, "shape", "shape:arrow")
    menu(page, "arr", "flip:h")
    menu(page, "line", "line:#C00000")
    page.wait_for_timeout(600)                             # 색을 바꾸면 다른 프로그램용 그림(png)도 다시 준비한다
    it = copied(ctx, page)["items"][0]
    assert it["type"] == "graphic" and it["flip"] == "h" and it["line"]["arrow"] and it["line"]["color"].upper() == "#C00000"
    assert it.get("png") and it.get("look")                # Word·한글이 받는 그림 — 지금 색·돌림으로
    flow.bring_to_front()
    flow.keyboard.press("Escape")
    flow.keyboard.press("Control+v")
    fl = f2.locator(':scope > svg[data-hs-box][data-name="deckops:arrow"]')
    assert fl.count() == 1 and fl.evaluate("(e) => [e.style.scale, e.style.rotate]") == ["-1 1", ""]
    assert fl.locator("line").get_attribute("stroke") == "#C00000" and fl.locator("line").get_attribute("style") is None
    # 흐름 덱의 그 선을 빌더 덱에 — 빌더 덱의 선(svg.el + 선 이름표)으로(A 의 거르기가 이름표·대칭을 지나 보낸다)
    flow.keyboard.press("Control+c")                       # 붙여 넣은 선이 골라져 있다
    page.bring_to_front()
    page.keyboard.press("Escape")
    page.keyboard.press("Control+v")
    bl = s3.locator(':scope > svg.el[data-name="deckops:arrow"]')
    assert bl.count() == 2 and bl.last.evaluate("(e) => [e.getAttribute('class'), e.style.scale]") == ["el", "-1 1"]
    assert bl.last.locator("line").get_attribute("stroke") == "#C00000"
    ctx.close()
    assert errors == [] and errors2 == []
