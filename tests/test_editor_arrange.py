"""덱 편집기 6단계 — 여러 상자 고르기·맞추기·같은 간격·맞춤선·앞뒤 순서·묶기·잠그기, 서식 복사(서식 붓), 표의 행·열 편집.
브라우저(Playwright)로 눌러 보고, 저장은 GitHub contents API 를 가로챈 DeckHub 에서 본다(시험 틀은 test_editor.py 의 것)."""
import pytest

from test_editor import (  # noqa: F401 — browser·serve 는 fixture
    BUILDER, FLOW, DeckHub, browser, caret, drag, frame, make_site, open_editor, parse_saved, same_dom, save_with_token,
    select_text, serve, state, wait_saved,
)

# 둘째 장에 글 없는 상자(도형) 셋 — a(100,100 100×50) · b(300,200 200×50) · c(700,150 100×100)
SHAPES = ('<div class="el" data-name="a" style="left:100px;top:100px;width:100px;height:50px;background:#EE3333"></div>'
          '<div class="el" data-name="b" style="left:300px;top:200px;width:200px;height:50px;background:#33AA33"></div>'
          '<div class="el" data-name="c" style="left:700px;top:150px;width:100px;height:100px;background:#3333EE"></div>')
# 셋째 장의 표 — 머리 행(위 끝 굵은 선)·가운데 행(옅은 선)·끝 행(아래 끝 굵은 선), 열 폭 200·400(표 폭 600)
TD = '<td style="padding:4px;{b}"><p class="pp" style="font-size:{s}px{w}">{t}</p></td>'
HEAD = 'border-top:2px solid #111111;border-bottom:1px solid #111111'
MID = 'border-bottom:1px solid #CCCCCC'
END = 'border-bottom:2px solid #111111'
TABLE = ('<table class="el tb" data-name="tbl" style="left:64px;top:160px;width:600px">'
         '<colgroup><col style="width:200px"><col style="width:400px"></colgroup>'
         + '<tr style="height:30px">' + TD.format(b=HEAD, s=15, w=';font-weight:700', t='머리 1') + TD.format(b=HEAD, s=15, w=';font-weight:700', t='머리 2') + '</tr>'
         + '<tr style="height:30px">' + TD.format(b=MID, s=16, w='', t='가') + TD.format(b=MID, s=16, w='', t='나') + '</tr>'
         + '<tr style="height:30px">' + TD.format(b=END, s=16, w='', t='다') + TD.format(b=END, s=16, w='', t='라') + '</tr>'
         + '</table>')
ARR = (BUILDER.replace('<svg class="el"', SHAPES + '<svg class="el"', 1)
       .replace('<table class="el" style="left:64px;top:160px;width:600px"><tbody><tr><td>칸 하나</td><td>칸 둘</td></tr></tbody></table>', TABLE))


@pytest.fixture
def arr(tmp_path, serve):
    site, root = make_site(tmp_path, {"arr.html": ARR, "flow.html": FLOW})
    hub = DeckHub({f"decks/{n}": (root / "decks" / n).read_bytes() for n in ("arr.html", "flow.html")})
    return serve(site), hub


def slide2(page):
    return frame(page).locator("section.slide").nth(1)


def geo(page, name: str) -> list:
    """둘째 장 상자의 [왼쪽, 위, 가로, 세로](style 의 px)."""
    return slide2(page).locator(f":scope > [data-name={name}]").evaluate(
        "(e) => [e.style.left, e.style.top, e.style.width, e.style.height].map(parseFloat)")


def order(page) -> list:
    return slide2(page).evaluate("(s) => [...s.children].map((e) => e.getAttribute('data-name'))")


def at(page, x: float, y: float) -> tuple:
    """덱 px (x, y) → 편집기 화면의 점."""
    b = page.locator("#frame").bounding_box()
    s = state(page)["scale"]
    return b["x"] + x * s, b["y"] + y * s


def click_box(page, name: str, mod: str = "") -> None:
    box = slide2(page).locator(f":scope > [data-name={name}]")
    if mod:
        box.click(modifiers=[mod])
    else:
        box.click()


def menu(page, which: str, act: str) -> None:
    page.click(f"#{which}Btn")
    page.click(f"#{which}Menu [data-act='{act}']")


def open_arr(browser, arr):
    base, hub = arr
    ctx, page, errors = open_editor(browser, base, "arr", hub)
    page.keyboard.press("PageDown")
    return ctx, page, errors, hub


# ---------- 여러 상자 고르기 · 맞추기 · 같은 간격

def test_shift_click_selects_several_and_aligns_them_in_one_step(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    click_box(page, "a")
    click_box(page, "b", "Shift")
    assert state(page)["sel"] == 2 and page.locator(".pick.multi").is_visible()
    assert page.locator(".pick-mem:not([hidden])").count() == 2
    menu(page, "arr", "align:left")                         # 여럿은 고른 것끼리 — 가장 왼쪽(a 의 100)에
    assert geo(page, "a")[0] == 100 and geo(page, "b")[0] == 100 and state(page)["undo"] == 1
    menu(page, "arr", "align:bottom")                      # 아래 끝(b 의 250)에 — a 는 위가 200 으로
    assert geo(page, "a")[1] == 200 and geo(page, "b")[1] == 200
    page.keyboard.press("ArrowRight")                      # 방향키는 고른 상자 모두를
    assert geo(page, "a")[0] == 101 and geo(page, "b")[0] == 101
    click_box(page, "b", "Shift")                          # Shift 로 다시 누르면 고르기에서 뺀다
    assert state(page)["sel"] == 1
    menu(page, "arr", "align:center")                      # 하나는 장에 — (1280 - 100) / 2
    assert geo(page, "a")[0] == 590
    for _ in range(4):
        page.keyboard.press("Control+z")
    page.wait_for_timeout(100)
    assert geo(page, "a")[:2] == [100, 100] and geo(page, "b")[:2] == [300, 200]
    ctx.close()
    assert errors == []


def test_shift_click_leaves_the_text_being_edited(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    slide2(page).locator("[data-name=body] .tin p").first.click()      # 글상자를 눌러 글을 고친다(상자도 골라진다)
    select_text(page, "section.slide:nth-of-type(2) [data-name=body] .tin", "첫 문단")
    click_box(page, "a", "Shift")                          # 글상자와 도형 a — 고르던 글은 풀린다(남으면 서식이 그 글에만 들어간다)
    assert state(page)["sel"] == 2
    page.wait_for_timeout(60)
    assert slide2(page).evaluate("(s) => s.ownerDocument.getSelection().rangeCount") == 0
    page.click("#fBold")                                   # 고른 상자들의 글 모두에
    weights = slide2(page).locator("[data-name=body] .tin p").evaluate_all("(ps) => ps.map((p) => getComputedStyle(p).fontWeight)")
    assert len(weights) == 2 and set(weights) == {"700"}
    ctx.close()
    assert errors == []


def test_marquee_and_select_all_and_distribute(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    x0, y0 = at(page, 900, 650)                           # 빈 곳에서 끌어 감싼 상자를 고른다(다 들어간 것만)
    x1, y1 = at(page, 90, 95)
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=8)
    assert page.locator(".pick-band").is_visible()
    page.mouse.up()
    assert state(page)["sel"] == 3 and not page.locator(".pick-band").is_visible()
    menu(page, "arr", "dist:h")                            # 양 끝(a·c)은 두고 가운데 b 를 — 사이 간격 150 씩
    assert geo(page, "a")[0] == 100 and geo(page, "b")[0] == 350 and geo(page, "c")[0] == 700
    page.keyboard.press("Escape")
    assert state(page)["sel"] == 0
    page.keyboard.press("Control+a")                       # 이 장의 상자 모두(글상자·도형·그림·쪽 번호)
    assert state(page)["sel"] == 8
    page.keyboard.press("Escape")
    ctx.close()
    assert errors == []


def test_snap_guides_while_dragging_and_alt_turns_them_off(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    s = state(page)["scale"]
    x, y = at(page, 150, 125)                              # a 의 가운데를 눌러 끈다 — 왼쪽 끝 297 → b 의 왼쪽 300 에 붙는다
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 197 * s, y + 3 * s, steps=8)
    assert page.locator(".pick-guide:not([hidden])").count() >= 1
    page.mouse.up()
    assert geo(page, "a")[0] == 300 and page.locator(".pick-guide:not([hidden])").count() == 0
    page.keyboard.press("Control+z")
    x, y = at(page, 150, 125)
    page.keyboard.down("Alt")                              # Alt 를 누른 채 끌면 붙지 않는다
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 196 * s, y, steps=8)
    page.mouse.up()
    page.keyboard.up("Alt")
    assert abs(geo(page, "a")[0] - 296) <= 1
    ctx.close()
    assert errors == []


# ---------- 앞뒤 순서 · 묶기 · 잠그기

def test_order_group_and_lock_survive_saving(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    click_box(page, "a")
    menu(page, "arr", "order:front")
    assert order(page)[-1] == "a"
    menu(page, "arr", "order:back")
    assert order(page)[0] == "a"
    menu(page, "arr", "order:forward")
    assert order(page)[1] == "a"
    # 묶기 — 하나를 누르면 함께 골라지고 함께 옮겨진다. 다시 누르면 그 상자만.
    click_box(page, "b", "Shift")
    page.keyboard.press("Control+g")
    groups = slide2(page).locator("[data-hs-group]").evaluate_all("(es) => es.map((e) => e.getAttribute('data-hs-group'))")
    assert len(groups) == 2 and len(set(groups)) == 1
    page.keyboard.press("Escape")
    # a 는 이제 제목 상자(위 70~130) 뒤에 있다 — 덮이지 않은 아랫부분을 누른다
    page.mouse.click(*at(page, 150, 142))
    assert state(page)["sel"] == 2
    page.keyboard.press("ArrowDown")
    assert geo(page, "a")[1] == 101 and geo(page, "b")[1] == 201
    page.mouse.click(*at(page, 150, 143))
    assert state(page)["sel"] == 1
    # 잠그기 — 방향키·지우기·끌기가 듣지 않는다(글은 고칠 수 있다)
    page.keyboard.press("Escape")
    click_box(page, "c")
    menu(page, "arr", "lock")
    assert slide2(page).locator(":scope > [data-name=c]").get_attribute("data-hs-lock") == ""
    assert page.locator(".pick.locked").is_visible()
    page.keyboard.press("ArrowRight")
    page.keyboard.press("Delete")
    assert geo(page, "c")[0] == 700 and slide2(page).locator(":scope > [data-name=c]").count() == 1
    assert "잠근" in page.inner_text("#status")
    s = state(page)["scale"]
    x, y = at(page, 750, 200)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 50 * s, y, steps=5)
    page.mouse.up()
    assert geo(page, "c")[0] == 700
    save_with_token(page)
    wait_saved(page, hub)
    text = hub.saved("decks/arr.html")
    got = page.evaluate("""(t) => { const d = new DOMParser().parseFromString(t, 'text/html');
        const s = d.querySelectorAll('section.slide')[1];
        return [[...s.querySelectorAll('[data-hs-group]')].map((e) => e.getAttribute('data-name')),
                [...s.querySelectorAll('[data-hs-lock]')].map((e) => e.getAttribute('data-name'))]; }""", text)
    assert got == [["a", "b"], ["c"]] or got == [["b", "a"], ["c"]]
    assert parse_saved(page, text)["hse"] is False
    menu(page, "arr", "unlock")
    page.keyboard.press("ArrowRight")
    assert geo(page, "c")[0] == 701
    ctx.close()
    assert errors == []


def test_copy_paste_and_delete_several_boxes(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    click_box(page, "a")
    click_box(page, "b", "Shift")
    page.keyboard.press("Control+g")
    page.keyboard.press("Control+c")
    page.keyboard.press("Escape")
    page.keyboard.press("PageDown")
    page.keyboard.press("Control+v")
    s3 = frame(page).locator("section.slide").nth(2)
    pasted = s3.locator(":scope > [data-hs-group]")
    assert pasted.count() == 2 and state(page)["sel"] == 2
    g_old = slide2(page).locator(":scope > [data-name=a]").get_attribute("data-hs-group")
    g_new = set(pasted.evaluate_all("(es) => es.map((e) => e.getAttribute('data-hs-group'))"))
    assert len(g_new) == 1 and g_old not in g_new         # 붙여 넣은 묶음은 새 이름(원래 묶음과 섞이지 않게)
    undo = state(page)["undo"]
    page.keyboard.press("Delete")                          # 여럿을 한 번에 — 되돌리기 한 칸
    assert pasted.count() == 0 and state(page)["undo"] == undo + 1
    page.keyboard.press("Control+z")
    assert pasted.count() == 2
    ctx.close()
    assert errors == []


# ---------- 서식 복사(서식 붓)

def test_format_painter_once_sticky_and_shortcuts(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    f2 = slide2(page)
    select_text(page, "section.slide:nth-of-type(2) [data-name=body] .tin", "첫 문단")
    page.keyboard.press("Control+b")
    page.evaluate("""() => { const c = document.getElementById('fColor'); c.value = '#ff0000';
        c.dispatchEvent(new Event('change', { bubbles: true })); }""")
    caret(page, "section.slide:nth-of-type(2) [data-name=body] .tin", "첫 문단", 1)
    page.click("#fPaint")                                   # 한 번 — 다음에 누른 글 칸 전체에 입히고 꺼진다
    assert page.get_attribute("#fPaint", "aria-pressed") == "true"
    undo = state(page)["undo"]
    f2.locator("[data-name=kicker] .tin p").click()
    page.wait_for_timeout(100)
    look = f2.locator("[data-name=kicker] .tin p").evaluate("""(p) => { const t = p.querySelector('span') || p;
        const c = getComputedStyle(t); return [c.fontWeight, c.color, c.fontSize]; }""")
    assert look == ["700", "rgb(255, 0, 0)", "24px"]
    assert page.get_attribute("#fPaint", "aria-pressed") == "false" and state(page)["undo"] == undo + 1
    # 여러 번(더블클릭) — Esc 로 끝
    caret(page, "section.slide:nth-of-type(2) [data-name=body] .tin", "첫 문단", 1)
    page.dblclick("#fPaint")
    f2.locator("[data-name=title] .tin p").click()
    page.wait_for_timeout(100)
    f2.locator("[data-name=pageno] .tin p").click()
    page.wait_for_timeout(100)
    assert page.get_attribute("#fPaint", "aria-pressed") == "true"
    assert f2.locator("[data-name=pageno] .tin p").evaluate("(p) => getComputedStyle(p.querySelector('span') || p).color") == "rgb(255, 0, 0)"
    page.keyboard.press("Escape")
    assert page.get_attribute("#fPaint", "aria-pressed") == "false"
    # 상자 모양 — 도형 a 의 바탕을 b 에
    click_box(page, "a")
    page.click("#fPaint")
    click_box(page, "b")
    page.wait_for_timeout(100)
    assert slide2(page).locator(":scope > [data-name=b]").evaluate("(e) => getComputedStyle(e).backgroundColor") == "rgb(238, 51, 51)"
    assert geo(page, "b") == [300, 200, 200, 50]           # 자리·크기는 그대로
    # Ctrl+Shift+C 로 집고 Ctrl+Shift+V 로 입힌다
    click_box(page, "c")
    page.keyboard.press("Control+Shift+c")
    click_box(page, "a")
    page.keyboard.press("Control+Shift+v")
    assert slide2(page).locator(":scope > [data-name=a]").evaluate("(e) => getComputedStyle(e).backgroundColor") == "rgb(51, 51, 238)"
    ctx.close()
    assert errors == []


# ---------- 표의 행·열

def cells(page, i: int = 2) -> list:
    return frame(page).locator("section.slide").nth(i).locator("table").evaluate(
        "(t) => [...t.rows].map((r) => [...r.cells].map((c) => c.textContent))")


def edges(page) -> list:
    return frame(page).locator("section.slide").nth(2).locator("table").evaluate(
        "(t) => [...t.rows].map((r) => r.cells[0].style.borderBottom)")


def test_builder_table_rows_and_columns_keep_the_edge_rules_and_width(browser, arr):
    base, hub = arr
    ctx, page, errors = open_editor(browser, base, "arr", hub)
    page.keyboard.press("PageDown")
    page.keyboard.press("PageDown")
    tin = "section.slide:nth-of-type(3) table"
    caret(page, tin, "다")
    menu(page, "tbl", "row-below")                          # 끝 행 아래에 — 끝 굵은 선은 새 끝 행으로
    assert cells(page) == [["머리 1", "머리 2"], ["가", "나"], ["다", "라"], ["", ""]]
    assert edges(page) == ["1px solid rgb(17, 17, 17)", "1px solid rgb(204, 204, 204)", "1px solid rgb(204, 204, 204)",
                           "2px solid rgb(17, 17, 17)"]
    page.keyboard.type("마")                                # 캐럿은 새 행의 같은 열에
    page.wait_for_timeout(900)
    assert cells(page)[3] == ["마", ""]
    assert frame(page).locator("section.slide").nth(2).locator("tr").nth(3).locator("p.pp").first.evaluate(
        "(p) => p.style.fontSize") == "16px"
    caret(page, tin, "나")
    menu(page, "tbl", "col-right")                          # 표 폭(600)은 그대로, 열 폭을 비율대로
    assert cells(page)[0] == ["머리 1", "머리 2", ""]
    widths = frame(page).locator("section.slide").nth(2).locator("col").evaluate_all("(cs) => cs.map((c) => c.style.width)")
    assert widths == ["120px", "240px", "240px"]
    caret(page, tin, "가")
    menu(page, "tbl", "row-del")
    assert [r[0] for r in cells(page)] == ["머리 1", "다", "마"]
    caret(page, tin, "마")
    menu(page, "tbl", "row-del")                            # 끝 행을 지우면 그 위 행이 끝 선을 받는다
    assert edges(page)[-1] == "2px solid rgb(17, 17, 17)"
    caret(page, tin, "머리 1")
    menu(page, "tbl", "col-del")
    assert cells(page) == [["머리 2", ""], ["라", ""]]
    for _ in range(6):                                     # 행·열 다섯 번 + 글 입력 한 번
        page.keyboard.press("Control+z")
    page.wait_for_timeout(100)
    assert cells(page) == [["머리 1", "머리 2"], ["가", "나"], ["다", "라"]]
    # 칸을 합친 표는 고치지 않는다
    frame(page).locator("section.slide").nth(2).locator("td").first.evaluate("(c) => { c.colSpan = 2; }")
    caret(page, tin, "가")
    menu(page, "tbl", "row-below")
    assert len(cells(page)) == 3 and "합친" in page.inner_text("#status")
    ctx.close()
    assert errors == []


def test_flow_table_rows_go_into_the_body_and_new_cells_take_typing(browser, arr):
    base, hub = arr
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    page.keyboard.press("PageDown")
    page.keyboard.press("PageDown")
    caret(page, "section.slide:nth-of-type(3) table", "머리")
    menu(page, "tbl", "row-below")                          # 머리 행(thead) 아래 — 본문(tbody)의 첫 행으로, td 로
    shape = frame(page).locator("section.slide").nth(2).locator("table").evaluate(
        "(t) => [t.tHead.rows.length, t.tBodies[0].rows.length, t.tBodies[0].rows[0].cells[0].tagName]")
    assert shape == [1, 2, "TD"]
    page.keyboard.type("새 칸")
    page.wait_for_timeout(900)
    assert cells(page) == [["머리"], ["새 칸"], ["칸"]]
    caret(page, "section.slide:nth-of-type(3) table", "칸", 0)
    menu(page, "tbl", "col-left")
    assert cells(page) == [["", "머리"], ["", "새 칸"], ["", "칸"]]
    assert frame(page).locator("section.slide").nth(2).locator("tr").first.locator(":scope > *").first.evaluate("(c) => c.tagName") == "TH"
    ctx.close()
    assert errors == []


def test_menus_keep_keys_to_themselves(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    click_box(page, "a")
    page.focus("#arrBtn")
    page.keyboard.press("Enter")                            # 키보드로 열면 첫 항목에 초점
    assert page.locator("#arrMenu").is_visible()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")                        # 메뉴 안의 방향키는 상자를 옮기지 않는다
    assert geo(page, "a")[:2] == [100, 100]
    page.keyboard.press("Escape")
    assert not page.locator("#arrMenu").is_visible() and state(page)["sel"] == 1
    page.click("#tblBtn")                                  # 표 칸이 아니면 표 메뉴 항목은 꺼져 있다
    assert page.locator("#tblMenu [data-act='row-below']").is_disabled()
    page.keyboard.press("Escape")
    ctx.close()
    assert errors == []


def test_untouched_arrange_deck_round_trips(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    click_box(page, "a")
    click_box(page, "b", "Shift")
    page.keyboard.press("Escape")
    assert same_dom(page, hub.saved("decks/arr.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


# ---------- 검토에서 찾은 것들(옛 글 고르기·잠근 묶음·한 칸 앞으로·한 축만·메뉴 초점·표의 열 폭·작은 표·빈 칸)

def weights(page) -> list:
    """둘째 장 글 상자들의 첫 글자 굵기."""
    return slide2(page).locator(".tin p").evaluate_all("""(ps) => ps.map((p) => {
        const t = p.ownerDocument.createTreeWalker(p, 4).nextNode(); return getComputedStyle(t.parentElement).fontWeight; })""")


def test_pressing_a_shape_drops_the_old_text_selection(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    f2 = slide2(page)
    body = f2.locator("[data-name=body] .tin")
    caret(page, "section.slide:nth-of-type(2) [data-name=body] .tin", "첫 문단", 1)
    page.click("#fPaint")                                   # 글 모양을 집고
    before = body.evaluate("(t) => t.innerHTML")
    click_box(page, "a")                                    # 글 없는 도형을 누르면 옛 캐럿의 글 칸을 다시 칠하지 않는다
    page.wait_for_timeout(100)
    assert body.evaluate("(t) => t.innerHTML") == before
    assert f2.evaluate("(s) => s.ownerDocument.getSelection().rangeCount") == 0
    ctx.close()
    assert errors == []


def test_select_all_after_typing_formats_every_box(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    slide2(page).locator("[data-name=body] .tin p").first.click()
    page.keyboard.press("Escape")                           # 글 고치기를 마치고(캐럿은 남은 채)
    page.keyboard.press("Control+a")                        # 이 장의 상자 모두 — 남은 캐럿을 풀어야 서식이 모두에 간다
    page.wait_for_timeout(60)
    assert state(page)["sel"] == 8
    page.keyboard.press("Control+b")
    assert set(weights(page)) == {"700"}
    ctx.close()
    assert errors == []


def test_shift_click_inside_the_text_being_edited_extends_it(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    p = slide2(page).locator("[data-name=body] .tin p").first
    b = p.bounding_box()
    page.mouse.click(b["x"] + 2, b["y"] + b["height"] / 2)  # 첫 문단 앞에 캐럿
    page.keyboard.down("Shift")
    page.mouse.click(b["x"] + 40, b["y"] + b["height"] / 2)   # Shift+누르기 — 글 고르기를 넓힌다(상자 고르기를 바꾸지 않는다)
    page.keyboard.up("Shift")
    assert state(page)["sel"] == 1
    assert p.evaluate("(p) => p.ownerDocument.getSelection().toString()") != ""
    ctx.close()
    assert errors == []


def test_a_group_with_a_locked_box_does_not_come_apart(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    click_box(page, "a")
    menu(page, "arr", "lock")
    click_box(page, "b", "Shift")
    page.keyboard.press("Control+g")
    page.keyboard.press("Escape")
    click_box(page, "b")                                    # 묶음째 골라진다
    assert state(page)["sel"] == 2
    page.keyboard.press("ArrowRight")                       # 잠근 상자가 든 묶음은 통째로 두고 알린다
    assert geo(page, "a")[:2] == [100, 100] and geo(page, "b")[:2] == [300, 200]
    assert "묶음" in page.inner_text("#status")
    b = slide2(page).locator(":scope > [data-name=b]").bounding_box()
    page.mouse.move(b["x"] + 20, b["y"] + 20)
    page.mouse.down()
    page.mouse.move(b["x"] + 80, b["y"] + 20, steps=6)
    page.mouse.up()
    assert geo(page, "a")[:2] == [100, 100] and geo(page, "b")[:2] == [300, 200]
    ctx.close()
    assert errors == []


def test_forward_steps_each_box_and_align_keeps_the_other_axis(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    click_box(page, "b")
    click_box(page, "pageno", "Shift")                      # 떨어져 있고 하나는 이미 맨 앞
    menu(page, "arr", "order:forward")
    assert order(page) == ["kicker", "title", "body", "a", "c", "b", None, "pageno"]
    page.keyboard.press("Escape")
    slide2(page).locator(":scope > [data-name=b]").evaluate("(e) => { e.style.top = '200.5px'; }")
    click_box(page, "a")
    click_box(page, "b", "Shift")
    menu(page, "arr", "align:left")                         # 가로만 맞춘다 — 세로의 소수 자리 값은 그대로
    assert slide2(page).locator(":scope > [data-name=b]").evaluate("(e) => [e.style.left, e.style.top]") == ["100px", "200.5px"]
    ctx.close()
    assert errors == []


def test_menu_choice_by_keyboard_leaves_keys_working(browser, arr):
    ctx, page, errors, hub = open_arr(browser, arr)
    click_box(page, "a")
    click_box(page, "b", "Shift")
    page.focus("#arrBtn")
    page.keyboard.press("Enter")                            # 열면 첫 항목(왼쪽 끝 맞추기)에 초점
    page.keyboard.press("Enter")
    assert not page.locator("#arrMenu").is_visible() and geo(page, "b")[0] == 100
    assert page.evaluate("!document.activeElement.closest('[role=menu]')")
    page.keyboard.press("ArrowRight")                       # 숨은 항목에 초점이 남지 않아 방향키가 상자를 옮긴다
    assert geo(page, "a")[0] == 101 and geo(page, "b")[0] == 101
    page.keyboard.press("Escape")
    click_box(page, "c")
    page.focus("#tblBtn")                                   # 쓸 항목이 없으면 판에 초점 — ↓ 가 상자를 옮기지 않는다
    page.keyboard.press("Enter")
    page.keyboard.press("ArrowDown")
    assert geo(page, "c")[:2] == [700, 150]
    page.keyboard.press("Escape")
    ctx.close()
    assert errors == []


def test_table_percent_widths_span_cols_and_a_one_row_table(browser, arr):
    base, hub = arr
    ctx, page, errors = open_editor(browser, base, "arr", hub)
    page.keyboard.press("PageDown")
    page.keyboard.press("PageDown")
    tin = "section.slide:nth-of-type(3) table"
    t3 = frame(page).locator("section.slide").nth(2).locator("table")
    t3.evaluate("(t) => { const cs = t.querySelectorAll('col'); cs[0].style.width = '30%'; cs[1].style.width = '70%'; }")
    caret(page, tin, "나")
    menu(page, "tbl", "col-right")                          # % 열 폭은 % 합(100)을 지키며 다시 나눈다
    assert t3.evaluate("(t) => [...t.querySelectorAll('col')].map((c) => c.style.width)") == ["17.65%", "41.18%", "41.17%"]
    page.keyboard.press("Control+z")
    assert len(cells(page)[0]) == 2
    t3.evaluate("(t) => { t.querySelector('colgroup').innerHTML = '<col span=\"2\" style=\"width:300px\">'; }")
    caret(page, tin, "나")
    menu(page, "tbl", "col-right")                          # span 으로 묶어 적은 열 폭 — 열은 넣지 않고 알린다
    assert len(cells(page)[0]) == 2 and "열 폭 목록" in page.inner_text("#status")
    caret(page, tin, "가")
    menu(page, "tbl", "row-del")
    caret(page, tin, "다")
    menu(page, "tbl", "row-del")                            # 머리 행 하나만 — 위·아래 굵은 선
    caret(page, tin, "머리 1")
    menu(page, "tbl", "row-below")                          # 위 끝 선은 맨 위 행에만, 아래 선은 그대로
    assert t3.evaluate("(t) => [...t.rows].map((r) => r.cells[0].style.borderTop)") == ["2px solid rgb(17, 17, 17)", ""]
    assert edges(page) == ["2px solid rgb(17, 17, 17)", "2px solid rgb(17, 17, 17)"]
    ctx.close()
    assert errors == []


def test_picture_only_table_cells_are_not_text(browser, arr):
    base, hub = arr
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    t = frame(page).locator("section.slide").nth(2).locator("table")
    t.evaluate("""(t) => { const b = t.tBodies[0];
        b.insertRow().insertCell().innerHTML = '<img alt="" style="height:1em" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
        b.insertRow().insertCell().innerHTML = '<i class="icon"></i>';
        b.insertRow().insertCell().innerHTML = '<p><br></p>'; }""")
    page.keyboard.press("PageDown")
    page.keyboard.press("PageDown")                         # 셋째 장에 편집 표시를 붙인다
    assert t.evaluate("(t) => ['img', 'i', 'p'].map((s) => t.querySelector(s).getAttribute('contenteditable'))") == [None, None, "true"]
    ctx.close()
    assert errors == []
