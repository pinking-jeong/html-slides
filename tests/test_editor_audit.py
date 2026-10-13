"""덱 편집기 — 숫자 감사(왼쪽 칸 ‘숫자’ 탭): 자릿수만 다른 같은 값·장마다 조금 다른 값, 표의 합, 표기 섞임. 날짜·머리 번호·
쪽 번호·번호 같은 작은 정수·이름에 붙은 번호·첨자는 보지 않는다. 장 번호를 누르면 그 장의 그 숫자를 형광으로. 브라우저
(Playwright)로 눌러 본다."""
from playwright.sync_api import expect

from test_editor import (  # noqa: F401 — browser·serve 는 fixture
    BUILDER, FLOW, DeckHub, browser, frame, make_site, open_editor, select_text, serve, state,
)

HEAD = BUILDER.split("<section", 1)[0]
TAIL = BUILDER[BUILDER.rindex("</section>") + len("</section>"):].replace(
    '["첫 장 노트","둘째 장 노트 <b>","셋째 장 노트"]', '["", "", "", ""]')
BODY = 'class="el tx" data-name="body" style="left:64px;top:160px;width:1100px;height:300px"'


def pageno(k: int) -> str:
    return ('<div class="el tx" data-name="pageno" style="left:1150px;top:680px;width:80px;height:20px"><div class="tin">'
            f'<p class="pp" style="font-size:12px">{k} / 4</p></div></div>')


def section(k: int, title: str, inner: str) -> str:
    on = " on" if k == 1 else ""
    return (f'<section class="slide{on}" data-i="{k}" data-key="s0{k}" data-title="{title}" aria-label="{k}. {title}" '
            f'style="background:#FFFFFF">\n{inner}\n</section>\n')


def deck(slides: list[str], notes: int | None = None) -> str:
    """빌더 덱 — 장 글들을 이어 붙이고 노트 칸 수를 맞춘다."""
    tail = TAIL.lstrip("\n").replace('["", "", "", ""]', "[" + ", ".join(['""'] * (notes or len(slides))) + "]")
    return HEAD + "".join(slides) + tail


def text_box(k: int, title: str, *paras: str) -> str:
    return section(k, title, f'<div {BODY}><div class="tin">' + "".join(f'<p class="pp">{p}</p>' for p in paras)
                   + "</div></div>")


def table(rows: list[list[str]], head: list[str] | None = None, top: int = 160) -> str:
    """빌더 덱의 표 — 칸 글에 colspan·rowspan 을 쓰려면 칸 자리에 '<td …>…</td>' 를 그대로 넣는다."""
    cell = lambda c, t: c if c.startswith("<t") else f"<{t}>{c}</{t}>"  # noqa: E731
    thead = f"<thead><tr>{''.join(cell(c, 'th') for c in head)}</tr></thead>" if head else ""
    body = "".join(f"<tr>{''.join(cell(c, 'td') for c in row)}</tr>" for row in rows)
    return f'<table class="el" style="left:64px;top:{top}px;width:700px">{thead}<tbody>{body}</tbody></table>'


AUDIT = HEAD + "".join([
    section(1, "표지", '<div class="el tx" data-name="title" style="left:64px;top:200px;width:1100px;height:80px"><div class="tin">'
            '<p class="pp" style="font-size:52px">숫자 감사 시험 — 2026년 10월 13일</p></div></div>\n'
            '<div class="el tx" data-name="kicker" style="left:64px;top:120px;width:800px;height:24px"><div class="tin">'
            '<p class="pp" style="font-size:16px">1. 서론</p></div></div>'),
    section(2, "결과 하나", f'<div {BODY}><div class="tin"><p class="pp">정확도 0.262로 가장 높았다</p>'
            '<p class="pp">재현율 52.2%</p><p class="pp">사례 1,234건을 모았다</p><p class="pp">모델 2 와 모델 3 을 견줬다</p>'
            f'</div></div>\n{pageno(2)}'),
    section(3, "결과 둘", f'<div {BODY}><div class="tin"><p class="pp">정확도 0.26</p><p class="pp">재현율 48.0%</p>'
            f'<p class="pp">사례 5678건</p></div></div>\n{pageno(3)}'),
    section(4, "표", '<table class="el" style="left:64px;top:160px;width:700px"><tbody>'
            '<tr><th>구분</th><th>건수</th><th>비율</th><th>점수</th></tr>'
            '<tr><td>가</td><td>10</td><td>40%</td><td>0.81</td></tr>'
            '<tr><td>나</td><td>20</td><td>30%</td><td>0.8</td></tr>'
            '<tr><td>다</td><td>5</td><td>28%</td><td>0.775</td></tr>'
            '<tr><td>합계</td><td>36</td><td>98%</td><td></td></tr>'
            f'</tbody></table>\n{pageno(4)}'),
]) + TAIL.lstrip("\n")

LIT = """() => { const h = document.getElementById('frame').contentWindow.CSS.highlights.get('hse-hit');
  return h ? [...h].map((r) => r.toString()) : []; }"""
EXPECTED = [
    "정확도 — 자릿수가 다릅니다",
    "재현율 (%) — 장마다 값이 조금 다릅니다",
    "표의 합계가 맞지 않습니다 — 건수",
    "천 단위 자릿점을 섞어 썼습니다",
    "표의 한 열에서 소수 자릿수가 다릅니다 — 점수",
]


def open_deck(browser, tmp_path, serve, name: str, text: str):
    site, root = make_site(tmp_path, {f"{name}.html": text})
    hub = DeckHub({f"decks/{name}.html": (root / "decks" / f"{name}.html").read_bytes()})
    return open_editor(browser, serve(site), name, hub)


def listed(page) -> list[list[str]]:
    return page.evaluate("""() => [...document.querySelectorAll('#numList li')].map((li) =>
      [li.querySelector('.num-t').textContent, li.querySelector('.num-d').textContent])""")


def test_number_audit_points_out_numbers_that_disagree(browser, tmp_path, serve):
    ctx, page, errors = open_deck(browser, tmp_path, serve, "audit", AUDIT)
    assert state(page)["n"] == 4
    original = page.evaluate("window.__hse.serialize()")
    page.click("#tabNum")
    expect(page.locator("#numSum")).to_have_text(
        "숫자 17개를 살펴 5곳을 짚었습니다 — 살펴볼 곳일 뿐 틀렸다는 뜻은 아닙니다.")
    assert page.locator("#numList .num-t").all_inner_texts() == EXPECTED
    assert page.locator("#numList h3").all_inner_texts() == ["값", "표의 합", "표기"]
    details = page.locator("#numList .num-d").all_inner_texts()
    assert details[0] == "0.262(2장) · 0.26(3장)" and details[1] == "52.2%(2장) · 48.0%(3장)"
    assert details[2] == "합계 36 · 위 칸들의 합 35(4장)"
    assert details[3] == "네 자리 수 — 자릿점 있음: 1,234건(2장) / 없음: 5678건(3장)"
    # 살피기만 한다 — 덱은 그대로, 고친 것으로 치지 않는다
    assert page.evaluate("window.__hse.serialize()") == original and state(page)["dirty"] is False
    # 장 번호를 누르면 그 장으로 가서 그 숫자를 형광으로 — 장을 넘겨도 고른 것의 숫자를
    page.locator("#numList li[data-f='0'] [data-go='2']").click()
    assert state(page)["cur"] == 2 and page.evaluate(LIT) == ["0.26"]
    expect(page.locator("#numList li[data-f='0']")).to_have_class("cur")
    expect(page.locator("#numList li[data-f='0']")).to_have_attribute("aria-current", "true")
    page.locator("#numList li[data-f='0'] [data-go='1']").click()
    assert state(page)["cur"] == 1 and page.evaluate(LIT) == ["0.262"]
    page.locator("#numList li[data-f='2'] [data-go='3']").click()
    assert state(page)["cur"] == 3 and sorted(page.evaluate(LIT)) == ["10", "20", "36", "5"]
    # 고치면 조금 뒤 다시 살핀다 — 3장의 0.26 을 0.262 로 맞추면 그 곳은 빠진다
    page.locator("#numList li[data-f='0'] [data-go='2']").click()
    select_text(page, "section.slide:nth-of-type(3) [data-name=body] .tin", "0.26")
    page.keyboard.type("0.262")
    page.keyboard.press("Escape")
    expect(page.locator("#numList .num-t")).to_have_count(4)
    assert page.locator("#numList .num-t").all_inner_texts() == EXPECTED[1:]
    page.locator("#numList li[data-f='0'] [data-go='2']").click()
    assert page.evaluate(LIT) == ["48.0%"]
    page.click("#tabToc")
    assert page.evaluate(LIT) == []                               # 다른 탭으로 가면 형광을 끈다
    ctx.close()
    assert errors == []


def test_number_audit_ignores_dates_headings_and_ids(browser, tmp_path, serve):
    quiet = HEAD + "".join([
        section(1, "표지", f'<div {BODY}><div class="tin"><p class="pp">2025년 3월 2일 · 2026-10-13 · 14:30 · v1.2.3</p>'
                '<p class="pp">1. 서론</p><p class="pp">제2장 방법</p><p class="pp">모델 2 · 모델 3</p></div></div>'),
        section(2, "둘", f'<div {BODY}><div class="tin"><p class="pp">모델 4 · 모델 5</p><p class="pp">2024년에 시작</p>'
                '<p class="pp">U-235 · KN-23 · HS 284510 · IMO 8914934 · 제3호 · 2위 · 1분기 · 60Co · 3D · ±0.02</p>'
                '<p class="pp">doi:10.1234/abcd.5678 · https://example.com/a/123 · et al. [23] · pp. 123–145 · 2016~2021</p>'
                f'</div></div>\n{pageno(2)}'),
        section(3, "셋", f'<div {BODY}><div class="tin"><p class="pp">2023년</p><p class="pp">각주<sup>12</sup> · '
                f'UF<sub>6</sub> · <code>slides edit 345</code></p></div></div>\n{pageno(3)}'),
        section(4, "넷", f'<div {BODY}><div class="tin"><p class="pp">끝</p></div></div>\n{pageno(4)}'),
    ]) + TAIL.lstrip("\n")
    ctx, page, errors = open_deck(browser, tmp_path, serve, "quiet", quiet)
    page.click("#tabNum")
    expect(page.locator("#numSum")).to_have_text("숫자 0개를 살폈습니다 — 어긋나 보이는 곳이 없습니다.")
    expect(page.locator("#numList")).to_have_text("덱에서 살필 숫자를 찾지 못했습니다.")
    ctx.close()
    assert errors == []


RULES = deck([
    text_box(1, "표지", "숫자 감사 규칙 시험"),
    # 같은 이름의 값 — 각주 위첨자는 값에 붙지 않고, 전·후의 앞 값·범위는 다른 장 값과 견주지 않는다
    text_box(2, "글 하나", "정확도 0.81<sup>1</sup> · AP 0.978 · 재현율 22.0 → 52.2 · 국영 비율 53%~93%",
             "탐지율 87.5% · 비율 48% · 점수 0.285 · U-235 · KN-23 · et al. [23] · 12 models · P3 는 20년차",
             "2016~2021 g +0.76"),
    text_box(3, "글 둘", "정확도 0.81 · AP 0.406 · 재현율 52.20 · 국영 비율 93%",
             "탐지율 85.7% · 비율 48.0% · 점수 0.29 · U-238 · KN-25 · et al. [31] · 3 models · P3 는 10년차",
             "2022~2026 g +1.40"),
    # 칸 합치기 — 눈에 보이는 열대로(합계 이름 칸이 두 열), 합계 칸의 각주는 떼고
    section(4, "합친 칸", table([["가", "x", "10", "12"], ["나", "y", "20", "25"],
                                ['<td colspan="2">합계</td>', "30<sup>1</sup>", "38"]], ["구분", "세부", "A", "B"])),
    # thead 없는 머리 줄(1분기·2분기)과 rowspan
    section(5, "머리 줄", table([["지역", "1분기", "2분기"], ['<td rowspan="2">북부</td>', "10", "20"], ["5", "7"],
                                ["합계", "15", "27"]])),
    # 연도 같은 값도 표 칸이면 자료 — 위첨자 숫자는 떼고
    section(6, "연도 같은 값", table([["갑", "1500"], ["을", "2000"], ["병", "500²"], ["합계", "4000"]], ["항목", "수량"])
            + table([["구분", "2024", "2025"], ["정", "3", "4"]], top=420)),
    # 비율 열의 ‘전체’는 합이 아니다 · 맨 위 ‘계’
    section(7, "비율과 위 합계", table([["하나", "45.0%"], ["둘", "30.0%"], ["전체", "39.0%"]], ["모델", "정확도"])
            + table([["계", "40"], ["셋", "12"], ["넷", "30"]], ["구분", "건수"], top=420)),
    # 소계와 합계
    section(8, "소계", table([['<td rowspan="3">A</td>', "x", "1"], ["y", "2"], ["소계", "4"],
                             ['<td rowspan="3">B</td>', "z", "5"], ["w", "6"], ["소계", "11"],
                             ['<td colspan="2">합계</td>', "15"]], ["구분", "항목", "값"])),
    # 비중 열은 100 근처여야 — 정확도 열·전후 행은 보지 않는다
    section(9, "비중", table([["다섯", "33.1%", "33.1%"], ["여섯", "35.2%", "35.2%"], ["일곱", "30.0%", "30.0%"]],
                            ["부문", "비중", "정확도"])
            + table([["정밀도", "48.2%", "51.0%"]], ["지표", "전", "후"], top=420)),
    # 숫자만 든 칸의 소수 자릿수 — 글이 섞인 칸(기호 표)은 보지 않는다
    section(10, "자릿수", table([["여덟", "0.81"], ["아홉", "0.8"], ["열", "0.775"]], ["모델", "점수"])
            + table([["τ", "0.49 · 96%(다섯 설정)"], ["λ", "4.5배(후보 풀)"], ["ρ", "0.28(후보 풀)"]], ["기호", "대표 값"],
                    top=420)),
    # 천 단위 자릿점 · 표 안의 표(한 번만 센다)
    section(11, "자릿점", f'<div {BODY}><div class="tin"><p class="pp">사례 1,234건을 모았다 · 사례 5678건</p></div></div>\n'
            '<table class="el" style="left:64px;top:420px;width:700px"><tbody><tr><td>바깥'
            '<table><tbody><tr><td>안</td><td>7.25</td></tr></tbody></table></td></tr></tbody></table>'),
])
RULE_FINDINGS = [
    ["재현율 — 자릿수가 다릅니다", "52.2(2장) · 52.20(3장)"],
    ["비율 (%) — 자릿수가 다릅니다", "48%(2장) · 48.0%(3장)"],
    ["점수 — 자릿수가 다릅니다", "0.285(2장) · 0.29(3장)"],
    ["탐지율 (%) — 장마다 값이 조금 다릅니다", "87.5%(2장) · 85.7%(3장)"],
    ["표의 합계가 맞지 않습니다 — B", "합계 38 · 위 칸들의 합 37(4장)"],
    ["표의 합계가 맞지 않습니다 — 건수", "합계 40 · 아래 칸들의 합 42(7장)"],
    ["표의 소계가 맞지 않습니다 — 값", "소계 4 · 위 칸들의 합 3(8장)"],
    ["표의 합계가 맞지 않습니다 — 값", "합계 15 · 위 칸들의 합 14(8장)"],
    ["% 열의 합이 100 이 아닙니다 — 비중", "합 98.3%(9장)"],
    ["천 단위 자릿점을 섞어 썼습니다", "네 자리 수 — 자릿점 있음: 1,234건(11장) / 없음: 5678건(11장)"],
    ["표의 한 열에서 소수 자릿수가 다릅니다 — 점수", "0.81 · 0.8 · 0.775(10장)"],
]
NUMBERS = """async () => {
  const A = await import('./js/audit.js');
  const doc = document.getElementById('frame').contentDocument;
  const slides = [...doc.getElementById('stage').children].filter((e) => e.localName === 'section');
  return A.numbersIn({ slides, family: 'builder' }).map((n) => [n.slide + 1, n.text, n.label]);
}"""


def test_number_audit_rules_on_text_and_tables(browser, tmp_path, serve):
    ctx, page, errors = open_deck(browser, tmp_path, serve, "rules", RULES)
    original = page.evaluate("window.__hse.serialize()")
    page.click("#tabNum")
    expect(page.locator("#numList li")).to_have_count(len(RULE_FINDINGS))
    assert listed(page) == RULE_FINDINGS
    nums = page.evaluate(NUMBERS)
    texts = [t for _, t, _ in nums]
    assert texts.count("7.25") == 1                              # 표 안의 표는 한 번만
    assert ["2", "0.81", "정확도"] in [[str(s), t, lb] for s, t, lb in nums]   # 위첨자 각주는 값에 붙지 않는다
    assert not {"235", "238", "23", "31", "2016", "2021", "2022", "2026", "2024", "2025"} & set(texts)   # 번호·기간·머리 줄
    assert [6, "3", "정 · 2024"] in nums and [4, "30", "합계 · a"] in nums      # 머리 줄의 연도는 열 이름으로
    assert page.evaluate("window.__hse.serialize()") == original and state(page)["dirty"] is False
    ctx.close()
    assert errors == []


def test_number_audit_reads_flow_deck_tables(browser, tmp_path, serve):
    cells = "".join(f"<tr><td><p>{a}</p></td><td><p>{b}</p></td></tr>" for a, b in [("가", "10"), ("나", "20"), ("다", "99")])
    flow = FLOW.replace("<table><thead><tr><th>머리</th></tr></thead><tbody><tr><td>칸</td></tr></tbody></table>",
                        f"<table><thead><tr><th>구분</th><th>건수</th></tr></thead><tbody>{cells}"
                        "<tr><td><p>합계</p></td><td><p>130</p></td></tr></tbody></table>")
    ctx, page, errors = open_deck(browser, tmp_path, serve, "flow", flow)
    page.click("#tabNum")
    expect(page.locator("#numList li")).to_have_count(1)
    assert listed(page) == [["표의 합계가 맞지 않습니다 — 건수", "합계 130 · 위 칸들의 합 129(3장)"]]
    ctx.close()
    assert errors == []


def test_number_audit_keeps_focus_and_its_keys(browser, tmp_path, serve):
    ctx, page, errors = open_deck(browser, tmp_path, serve, "audit", AUDIT)
    page.click("#tabNum")
    expect(page.locator("#numList .num-t")).to_have_count(5)
    # 숫자 칸 안의 키(Delete·화살표)는 덱으로 가지 않는다
    page.locator("#numList li[data-f='1'] [data-go='1']").focus()
    before = page.evaluate("window.__hse.serialize()")
    for key in ("Delete", "ArrowDown", "ArrowRight", "Backspace"):
        page.keyboard.press(key)
    assert page.evaluate("window.__hse.serialize()") == before and state(page)["cur"] == 0
    # 덱을 고쳐 다시 살펴도 키보드 자리는 같은 곳(재현율, 2장)에 — 앞의 곳이 빠져 번호가 바뀌어도
    page.locator("#numList li[data-f='0'] [data-go='2']").click()
    select_text(page, "section.slide:nth-of-type(3) [data-name=body] .tin", "0.26")
    page.keyboard.type("0.262")
    page.keyboard.press("Escape")
    expect(page.locator("#numList .num-t")).to_have_count(4)
    page.locator("#numList li[data-f='0'] [data-go='1']").focus()
    page.keyboard.press("Control+z")                              # 되돌리면 앞의 곳이 다시 생겨 재현율은 1번으로
    expect(page.locator("#numList .num-t")).to_have_count(5)
    assert page.evaluate("""() => { const a = document.activeElement;
      return [a.tagName, a.dataset.f, a.dataset.go, a.closest('li').querySelector('.num-t').textContent]; }""") == [
        "BUTTON", "1", "1", "재현율 (%) — 장마다 값이 조금 다릅니다"]
    ctx.close()
    assert errors == []


def captioned(cap: str, rows: list[list[str]], head: list[str], top: int = 160) -> str:
    return table(rows, head, top).replace("<thead>", f"<caption>{cap}</caption><thead>", 1)


def titled(text: str) -> str:
    return ('<div class="el tx" data-name="title" style="left:64px;top:60px;width:1100px;height:60px"><div class="tin">'
            f'<p class="pp">{text}</p></div></div>')


PATHS = [["p1 관리", "−0.04"], ["p2 은닉", "−0.40"], ["p3 돌파", "−2.43"], ["p4 대결", "−6.12"]]
# 흔한 표·글 꼴에서 짚지 않아야 할 것과(묶음 합계·깔때기·그중·두 줄 머리·실험마다 같은 꼴의 표·반만 같은 표·자릿수 다른 학습률·
# 화학식·지수 표기·판 번호·큰 수 단위·두 해의 비중·키-값 표·px), 그래도 짚어야 할 것(th 합계 줄·점유율·‘12편’ 칸·줄표 음수·%p.·
# 제목이 달라도 다른 장에 다시 실은 표의 틀린 칸)
REVIEW = deck([
    text_box(1, "표지", "검토 사례"),
    section(2, "묶음 합계", table([["A1", "1"], ["A2", "2"], ["Total", "3"], ["B1", "4"], ["B2", "5"], ["Total", "9"],
                                   ["Grand total", "12"]], ["Region", "Units"])
            + table([["전체", "13,598"], ["G1 통과", "4,210"], ["G2 통과", "1,050"], ["G3 통과", "635"]], ["단계", "기사 수"],
                    top=420)),
    section(3, "그중과 두 줄 머리", table([["국내 매체", "420"], ["그중 국영", "180"], ["해외 매체", "300"], ["전체", "720"]],
                                         ["구분", "기사 수"])
            + table([['<td rowspan="2">구분</td>', '<td colspan="3">반복 실험</td>'], ["1", "2", "3"], ["가", "10", "12", "11"],
                     ["나", "20", "22", "21"], ["합계", "30", "34", "33"]], top=420)),
    section(4, "실험 하나", table([["A", "0.81", "0.75"], ["B", "0.85", "0.79"]], ["모델", "정확도", "재현율"])),
    section(5, "실험 둘", table([["A", "0.78", "0.72"], ["B", "0.83", "0.80"]], ["모델", "정확도", "재현율"])),
    section(6, "주 결과", captioned("주 결과", [["A", "0.81"]], ["모델", "정확도"])),
    section(7, "주 결과 다시", captioned("주 결과", [["A", "0.83"]], ["모델", "정확도"])),
    text_box(8, "사전 학습", "사전 학습: 학습률 0.001 · UF<sub>6</sub> 1,200 kg · 농도 2.1×10<sup>−3</sup> · Python 3.11",
             "예산 25억원 · 해상도 1080 px · Section 4.2"),
    text_box(9, "미세 조정", "미세 조정: 학습률 0.0001 · UF<sub>4</sub> 1,100 kg · 농도 2.3×10<sup>−4</sup> · Python 3.12",
             "예산 24만원 · 사례 1,234건 · Section 4.5"),
    section(10, "몫과 키-값", table([["국내", "48.0%", "49.5%"], ["해외", "52.0%", "50.5%"]], ["부문", "2024 비중", "2025 비중"])
            + table([["모델 A", "62.3%", "35.1%"]], ["모델", "In-distribution", "Out-of-distribution"], top=330)
            + table([["학습률", "0.001"], ["드롭아웃", "0.1"], ["가중치 감쇠", "0.01"]], ["하이퍼파라미터", "값"], top=480)),
    section(11, "합계 칸들", '<table class="el" style="left:64px;top:160px;width:700px"><thead><tr><th>구분</th><th>건수</th>'
            '</tr></thead><tbody><tr><td>가</td><td>10</td></tr><tr><td>나</td><td>20</td></tr>'
            '<tr><th>합계</th><th>31</th></tr></tbody></table>'
            + table([["A사", "45%"], ["B사", "35%"], ["C사", "15%"], ["합계", "100%"]], ["기업", "점유율"], top=330)
            + table([["학술지", "12편"], ["학회", "30편"], ["합계", "41편"]], ["구분", "논문 수"], top=520)),
    text_box(12, "부호", "변화 –0.03 · 증가율 5.2%p. 3분기에는 둔화"),
    text_box(13, "부호 둘", "변화 −0.04 · 증가율 5.4%p"),
    section(14, "결과표", titled("경로별 핵심 결과") + table(PATHS, ["경로", "비용"])),
    section(15, "요약", titled("편익은 비용의 한 자릿수") + table([["p1 관리", "−0.05"], *PATHS[1:]], ["경로", "비용"])),
    section(16, "다른 가정", titled("다른 가정의 결과") + table([["p1 관리", "−0.10"], PATHS[1], ["p3 돌파", "−2.00"],
                                                               ["p4 대결", "−6.00"]], ["경로", "비용"])),
])
REVIEW_FINDINGS = [
    ["A · 정확도 — 장마다 값이 조금 다릅니다", "0.81(6장) · 0.83(7장)"],
    ["변화 — 장마다 값이 조금 다릅니다", "–0.03(12장) · −0.04(13장)"],
    ["증가율 (%p) — 장마다 값이 조금 다릅니다", "5.2%p(12장) · 5.4%p(13장)"],
    ["p1 관리 · 비용 — 장마다 값이 조금 다릅니다", "−0.04(14장) · −0.05(15장)"],
    ["표의 합계가 맞지 않습니다 — 반복 실험 3", "합계 33 · 위 칸들의 합 32(3장)"],
    ["표의 합계가 맞지 않습니다 — 건수", "합계 31 · 위 칸들의 합 30(11장)"],
    ["표의 합계가 맞지 않습니다 — 점유율", "합계 100% · 위 칸들의 합 95%(11장)"],
    ["표의 합계가 맞지 않습니다 — 논문 수", "합계 41 · 위 칸들의 합 42(11장)"],
]


def test_number_audit_spares_common_layouts(browser, tmp_path, serve):
    ctx, page, errors = open_deck(browser, tmp_path, serve, "review", REVIEW)
    page.click("#tabNum")
    expect(page.locator("#numList li")).to_have_count(len(REVIEW_FINDINGS))
    assert listed(page) == REVIEW_FINDINGS
    nums = page.evaluate(NUMBERS)
    labels = {t: lb for _, t, lb in nums}
    assert labels["1,200"] == "uf₆" and labels["1,100"] == "uf₄"           # 아래첨자는 이름의 일부
    on = lambda s: {t for k, t, _ in nums if k == s}  # noqa: E731
    assert not {"1", "2", "3"} & on(3)                                         # 두 줄 머리의 아랫줄(1 | 2 | 3)
    assert not {"2.1", "2.3", "3.11", "3.12", "4.2", "4.5"} & (on(8) | on(9))  # 지수 표기·판·절 번호
    assert ["8", "25", "예산"] in [[str(s), t, lb] for s, t, lb in nums]      # 25억원 — 큰 수 단위째로
    ctx.close()
    assert errors == []


def test_number_audit_rereads_after_clearing_formatting(browser, tmp_path, serve):
    sup = deck([text_box(1, "표지", "시험"),
                section(2, "표", table([["가", "10"], ["나", "20"], ["합계", "<sup>31</sup>"]], ["구분", "건수"]))])
    ctx, page, errors = open_deck(browser, tmp_path, serve, "sup", sup)
    page.keyboard.press("PageDown")
    page.click("#tabNum")
    expect(page.locator("#numSum")).to_have_text("숫자 2개를 살폈습니다 — 어긋나 보이는 곳이 없습니다.")
    # 위첨자만 벗기면 글은 그대로지만 숫자가 된다 — 기억해 둔 것을 쓰지 않고 다시 읽는다
    select_text(page, "section.slide:nth-of-type(2) table", "31")
    page.click("#fClear")
    expect(page.locator("#numList .num-t")).to_have_text(["표의 합계가 맞지 않습니다 — 건수"])
    # ‘다시 살피기’는 처음부터 읽고, 요약 글이 같으면 그 글(aria-live)을 다시 쓰지 않는다
    page.evaluate("""() => { window.__sumWrites = 0;
      new MutationObserver((m) => { window.__sumWrites += m.length; })
        .observe(document.getElementById('numSum'), { childList: true, characterData: true, subtree: true }); }""")
    page.click("#numRun")
    expect(page.locator("#numList .num-t")).to_have_text(["표의 합계가 맞지 않습니다 — 건수"])
    assert page.evaluate("window.__sumWrites") == 0
    ctx.close()
    assert errors == []


# 두 번째 검토에서 나온 꼴 — 짚지 않아야 할 것(이중 용도 줄·위 합계와 아래 소계·진척률 100%·행 백분율의 계 열·‘-’ 칸·줄표
# 음수·(30) 회계 음수·들여 쓴 하위 줄·반씩 줄어드는 깔때기·빈 모서리 두 줄 머리·해마다의 비중 행·평가 지표 표·평균 줄·증감
# 줄·두 갈래 표·억 원 반올림·분포 이동 정확도·판 번호·다른 동위원소)과 짚어야 할 것(같은 동위원소의 조금 다른 값 — 위첨자
# 요소와 위첨자 글자는 같은 이름, ‘전체’의 1.4% 어긋남)
REVIEW2 = deck([
    text_box(1, "표지", "검토 사례 둘"),
    section(2, "이중 용도와 묶음", table([["원자력 전용 품목", "120"], ["이중 용도 품목", "340"], ["기타", "40"], ["합계", "500"]],
                                    ["구분", "건수"])
            + table([["합계", "41"], ["가1", "10"], ["가2", "20"], ["소계", "30"], ["나1", "5"], ["나2", "6"], ["소계", "11"]],
                    ["구분", "사례"], top=330)),
    section(3, "비율 열", table([["설계", "100%"], ["구현", "100%"], ["시험", "100%"], ["계", "100%"]], ["단계", "진척률"])
            + table([["남", "60%", "40%", "100%"], ["여", "55%", "45%", "100%"], ["합계", "57%", "43%", "100%"]],
                    ["구분", "찬성", "반대", "계"], top=330)),
    section(4, "빈 값과 음수", table([["분류", "품목", "건수"], ['<td rowspan="2">가</td>', "x", "-"], ["y", "20"],
                                   ['<td rowspan="2">나</td>', "z", "5"], ["w", "6"], ['<td colspan="2">합계</td>', "31"]])
            + table([["매출", "50"], ["기타수익", "60"], ["비용", "–30"], ["합계", "80"]], ["항목", "금액"], top=400)
            + table([["매출", "50"], ["기타수익", "60"], ["비용", "(30)"], ["합계", "80"]], ["항목", "손익"], top=550)),
    section(5, "들여 쓴 줄과 깔때기", table([["합계", "100"], ["○ 일반회계", "60"], ["- 사업1", "40"], ["- 사업2", "20"],
                                         ["○ 특별회계", "40"], ["- 사업3", "40"]], ["구분", "예산"])
            + table([["전체", "1,000"], ["1차 선별", "520"], ["2차 선별", "260"], ["최종 채택", "130"]], ["단계", "논문"], top=420)),
    section(6, "두 줄 머리와 몫", table([["", '<td colspan="3">반복 실험</td>'], ["", "1", "2", "3"], ["가", "10", "12", "11"],
                                      ["나", "20", "22", "21"], ["합계", "30", "34", "32"]])
            + table([["국내 매출 비중", "48%", "50%"], ["해외 매출 비중", "52%", "50%"]], ["구분", "2024", "2025"], top=420)),
    section(7, "지표 표와 평균", table([["정확도", "0.812", "0.80"], ["F1", "0.79", "0.811"], ["지연(ms)", "12.5", "13.2"]],
                                    ["평가 지표", "모델 A", "모델 B"])
            + table([["가", "10"], ["나", "20"], ["평균", "15"], ["합계", "30"]], ["구분", "회의"], top=360)
            + table([["구분", "2024", "2025"], ["증감", "–12", "–5"], ["국내", "10", "12"], ["해외", "20", "22"],
                     ["합계", "30", "34"]], top=520)),
    section(8, "두 갈래와 큰 수 단위", table([["계", "1,000"], ["남", "480"], ["여", "520"], ["20대", "300"], ["30대", "350"],
                                          ["40대 이상", "350"]], ["구분", "사례수"])
            + table([["가", "1,235"], ["나", "2,346"], ["합계", "3,580"]], ["구분", "금액(억 원)"], top=420)
            + table([["국내", "420"], ["해외", "310"], ["전체", "720"]], ["구분", "응답자"], top=560)),
    section(9, "분포와 동위원소", f'<div {BODY}><div class="tin"><p class="pp">²³⁹Pu 4.2 kg · ²⁴⁰Pu 0.3 kg · 개정 2.1판</p>'
            '</div></div>' + table([["A", "45%"], ["B", "35%"], ["C", "15%"]], ["모델", "분포 이동 정확도"], top=400)),
    text_box(10, "동위원소 둘", "<sup>239</sup>Pu 4.25 kg · <sup>240</sup>Pu 4.0 kg · 개정 2.2판"),
])
REVIEW2_FINDINGS = [
    ["²³⁹Pu (kg) — 장마다 값이 조금 다릅니다", "4.2(9장) · 4.25(10장)"],
    ["표의 합계가 맞지 않습니다 — 응답자", "합계 720 · 위 칸들의 합 730(8장)"],
]


def test_number_audit_spares_more_layouts(browser, tmp_path, serve):
    ctx, page, errors = open_deck(browser, tmp_path, serve, "review2", REVIEW2)
    page.click("#tabNum")
    expect(page.locator("#numList li")).to_have_count(len(REVIEW2_FINDINGS))
    assert listed(page) == REVIEW2_FINDINGS
    nums = page.evaluate(NUMBERS)
    on = lambda s: {t for k, t, _ in nums if k == s}  # noqa: E731
    assert not {"1", "2", "3"} & on(6)                                         # 빈 모서리 두 줄 머리의 아랫줄
    assert ["9", "0.3", "²⁴⁰pu"] in [[str(s), t, lb] for s, t, lb in nums]    # 질량수는 이름의 일부
    ctx.close()
    assert errors == []


def rs(n: int, text: str) -> str:
    return f'<td rowspan="{n}">{text}</td>'


def cs(n: int, text: str) -> str:
    return f'<td colspan="{n}">{text}</td>'


# 세 번째 검토에서 나온 꼴 — 짚지 않아야 할 것(첫 열을 합친 칸의 표시·ㅇ 글머리표·갈래 이름 ‘증가·감소’·글머리표 하나·‘- 국영’
# 그중 줄·행 백분율의 ‘계 100.0’·손익표의 순이익·단위 줄·‘(억)’·분기마다 0 이 가득한 표·‘일 매출’)과 짚어야 할 것(이웃 묶음과
# 우연히 맞는 묶음 합계 — 아래·위, 빈 윗줄 아래의 하위 줄, 줄표 음수의 표시, 마지막 줄과 같은 합계, 합치지 않은 열 밑이 빈
# 두 줄 머리, ‘조건’이 든 제목, m² 칸, 두 갈래의 틀린 계, ‘10년 미만’의 비중, 반올림해 옮겨 실은 요약표 — 칸 셋을 한 줄로).
# 네 번째 검토의 꼴(15·16장) — 짚지 않아야 할 것(연도 묶음마다의 소계·합계, 위 총계와 아래 계 묶음, ‘2호기 출력’과 ‘3호기
# 출력’은 다른 이름)과 짚어야 할 것(두 구역 표의 틀린 둘째 총계, 그중 줄 ‘- 국영’까지 더한 합계와 그 표를 옮겨 실은 4장과
# 다른 합계, 한 갈래만 틀린 두 갈래 계, ㎾ 와 kW 로 쓴 보조 출력)
REVIEW3 = deck([
    text_box(1, "표지", "검토 사례 셋"),
    section(2, "묶음 합계", table([["가1", "10"], ["가2", "20"], ["계", "30"], ["나1", "5"], ["나2", "6"], ["계", "30"],
                                   ["다1", "12"], ["다2", "18"], ["계", "30"]], ["구분", "건수"], top=100)
            + table([["계", "30"], ["가1", "10"], ["가2", "20"], ["계", "30"], ["나1", "5"], ["나2", "6"]], ["구분", "건수"],
                    top=420)),
    section(3, "들여 쓴 줄", table([[rs(2, "○ 국내"), "가", "10"], ["나", "20"], [rs(2, "○ 해외"), "다", "5"], ["라", "6"],
                                   [cs(2, "합계"), "41"]], ["구분", "항목", "건수"], top=100)
            + table([["□ 일반회계", "60"], ["ㅇ 사업1", "40"], ["ㅇ 사업2", "20"], ["□ 특별회계", "40"], ["합계", "100"]],
                    ["구분", "예산"], top=300)
            + table([["○ 일반회계", ""], ["- 사업1", "40"], ["- 사업2", "20"], ["○ 특별회계", ""], ["- 사업3", "40"],
                     ["합계", "110"]], ["구분", "예산"], top=480)),
    section(4, "갈래 이름과 그중", table([["증가", "30"], ["감소", "20"], ["유지", "40"], ["모름", "10"], ["합계", "100"]],
                                       ["응답", "건수"], top=100)
            + table([["국내", "100"], ["해외", "50"], ["● 신규", "30"], ["합계", "180"]], ["구분", "건수"], top=330)
            + table([["국내 매체", "420"], ["- 국영", "180"], ["해외 매체", "300"], ["합계", "720"]], ["구분", "기사 수"], top=520)),
    section(5, "행 백분율과 손익", table([["남", "500", "60.0", "40.0", "100.0"], ["여", "500", "70.0", "30.0", "100.0"],
                                       ["합계", "1,000", "65.0", "35.0", "100.0"]], ["구분", "사례수", "만족", "불만족", "계"], top=100)
            + table([["영업이익", "120"], ["영업외손익", "−30"], ["법인세", "–20"], ["순이익", "70"], ["합계", "70"]],
                    ["항목", "금액"], top=260)
            + table([["매출", "50"], ["비용", "–60"], ["합계", "–12"]], ["항목", "손익"], top=460)
            + table([["가", "10"], ["나", "20"], ["다", "30"], ["합계", "30"]], ["구분", "건수"], top=580)),
    section(6, "머리 줄과 단위", table([["구분", cs(2, "매출"), "비고"], ["", "2024", "2025", ""], ["가", "10", "12", "신규"],
                                     ["나", "20", "22", ""], ["합계", "31", "34", ""]], top=100)
            + table([["구분", "매출", "이익"], ["(단위)", "억 원", ""], ["가", "10", "1"], ["나", "20", "2"], ["합계", "31", "3"]],
                    top=330)
            + table([["가", "1,235"], ["나", "2,346"], ["합계", "3,580"]], ["구분", "금액(억)"], top=540)),
    section(7, "조건별 횟수", titled("실험 조건별 시험 횟수")
            + table([["가", "12"], ["나", "15"], ["다", "9"], ["라", "11"], ["합계", "49"]], ["조건", "횟수"])),
    section(8, "지수·두 갈래·기간 아닌 비중", table([["가", "1,200 m²"], ["나", "800 m²"], ["합계", "2,100 m²"]], ["구분", "면적"],
                                               top=100)
            + table([[cs(2, "계"), "1,010"], [rs(2, "성별"), "남", "480"], ["여", "520"], [rs(3, "연령"), "20대", "300"],
                     ["30대", "350"], ["40대 이상", "350"]], ["구분", "", "사례수"], top=260)
            + table([["5년 미만", "30%"], ["10년 미만", "40%"], ["10년 이상", "25%"]], ["근속 기간", "비중"], top=540)),
    section(9, "1분기", titled("1분기 사고 현황") + table([["가", "0", "12"], ["나", "0", "0"], ["다", "1", "0"], ["라", "0", "3"]],
                                                       ["구분", "중대", "경미"])),
    section(10, "2분기", titled("2분기 사고 현황") + table([["가", "0", "11"], ["나", "0", "0"], ["다", "1", "0"], ["라", "0", "4"]],
                                                        ["구분", "중대", "경미"])),
    section(11, "세부 결과", titled("세부 결과") + table([["A", "0.812"], ["B", "0.903"], ["C", "0.721"]], ["모델", "정확도"])),
    section(12, "요약", titled("요약") + table([["A", "0.81"], ["B", "0.90"], ["C", "0.72"]], ["모델", "정확도"])),
    text_box(13, "하루", "일 매출 3,000만 원 · 주 사용자 1.2만명", "수출 5억 달러 매출 3조 원"),
    text_box(14, "전체", "매출 2,800만 원 · 사용자 1.25만명"),
    section(15, "연도 묶음과 두 구역", table([[rs(7, "2024"), "가1", "10"], ["가2", "20"], ["소계", "30"], ["나1", "5"],
                                           ["나2", "6"], ["소계", "11"], ["합계", "41"], [rs(7, "2025"), "가1", "11"],
                                           ["가2", "21"], ["소계", "32"], ["나1", "6"], ["나2", "7"], ["소계", "13"],
                                           ["합계", "45"]], ["연도", "구분", "금액"], top=100)
            + table([["가1", "10"], ["가2", "20"], ["계", "30"], ["나1", "5"], ["나2", "6"], ["계", "11"], ["총계", "41"],
                     ["다1", "1"], ["다2", "2"], ["계", "3"], ["라1", "4"], ["라2", "5"], ["계", "9"], ["총계", "13"]],
                    ["구분", "건수"], top=100).replace("left:64px", "left:800px")
            + f'<div {BODY.replace("top:160px", "top:620px")}><div class="tin"><p class="pp">2호기 출력 650 MWe · 보조 출력 '
            '1,200㎾</p></div></div>'),
    section(16, "총계 위와 하위 줄", table([["총계", "41"], ["가1", "10"], ["가2", "20"], ["계", "30"], ["나1", "5"], ["나2", "6"],
                                         ["계", "11"]], ["구분", "건수"], top=100)
            + table([["국내 매체", "420"], ["- 국영", "180"], ["해외 매체", "300"], ["합계", "900"]], ["구분", "기사 수"],
                    top=360)
            + table([[cs(2, "계"), "1,000"], [rs(2, "성별"), "남", "490"], ["여", "500"], [rs(3, "연령"), "20대", "300"],
                     ["30대", "350"], ["40대 이상", "350"]], ["구분", "", "사례수"], top=100).replace("left:64px", "left:800px")
            + f'<div {BODY.replace("top:160px", "top:620px")}><div class="tin"><p class="pp">3호기 출력 690 MWe · 보조 출력 '
            '1,250 kW</p></div></div>'),
])
REVIEW3_FINDINGS = [
    ["옮겨 실은 표의 자릿수가 다릅니다 — 세부 결과", "3칸 — 0.812(11장) · 0.81(12장) / 0.903(11장) · 0.90(12장) …"],
    ["합계 · 기사 수 — 장마다 값이 조금 다릅니다", "720(4장) · 900(16장)"],
    ["보조 출력 (kW) — 장마다 값이 조금 다릅니다", "1,200(15장) · 1,250(16장)"],
    ["표의 합계가 맞지 않습니다 — 건수", "합계 30 · 위 칸들의 합 11(2장)"],
    ["표의 합계가 맞지 않습니다 — 건수", "합계 30 · 아래 칸들의 합 11(2장)"],
    ["표의 합계가 맞지 않습니다 — 예산", "합계 110 · 위 칸들의 합 100(3장)"],
    ["표의 합계가 맞지 않습니다 — 손익", "합계 –12 · 위 칸들의 합 –10(5장)"],
    ["표의 합계가 맞지 않습니다 — 건수", "합계 30 · 위 칸들의 합 60(5장)"],
    ["표의 합계가 맞지 않습니다 — 매출 2024", "합계 31 · 위 칸들의 합 30(6장)"],
    ["표의 합계가 맞지 않습니다 — 횟수", "합계 49 · 위 칸들의 합 47(7장)"],
    ["표의 합계가 맞지 않습니다 — 면적", "합계 2,100 · 위 칸들의 합 2,000(8장)"],
    ["표의 합계가 맞지 않습니다 — 사례수", "합계 1,010 · 아래 묶음마다의 합 1,000(8장)"],
    ["% 열의 합이 100 이 아닙니다 — 비중", "합 95%(8장)"],
    ["표의 합계가 맞지 않습니다 — 건수", "합계 13 · 위 칸들의 합 12(15장)"],
    ["표의 합계가 맞지 않습니다 — 기사 수", "합계 900 · 위 칸들의 합 720(16장)"],
    ["표의 합계가 맞지 않습니다 — 사례수", "합계 1,000 · 아래 묶음 하나의 합 990(16장)"],
]


def test_number_audit_pairs_each_total_with_its_own_block(browser, tmp_path, serve):
    ctx, page, errors = open_deck(browser, tmp_path, serve, "review3", REVIEW3)
    page.click("#tabNum")
    expect(page.locator("#numList li")).to_have_count(len(REVIEW3_FINDINGS))
    assert listed(page) == REVIEW3_FINDINGS
    nums = [[str(s), t, lb] for s, t, lb in page.evaluate(NUMBERS)]
    # 두 줄짜리 머리의 빈자리·단위 줄은 머리 — 열 이름으로
    assert ["6", "31", "합계 · 매출 2024"] in nums and ["6", "31", "합계 · 매출 억 원"] in nums
    # 한 글자 앞말은 이름에 잇고(‘일 매출’), 앞 수의 단위는 잇지 않는다
    assert ["13", "3,000", "일 매출"] in nums and ["14", "2,800", "매출"] in nums and ["13", "3", "매출"] in nums
    ctx.close()
    assert errors == []


# 다섯·여섯 번째 검토의 꼴 — 짚지 않아야 할 것(제 묶음이 한 줄뿐인 계를 둔 표의 위 합계, 합계 41 다음의 총계 44, ‘Total (excl.
# Other)’처럼 표의 다른 줄을 뺀 합계, 변이 이름 ‘Delta’, 버림했을 수도 있는 큰 수 단위의 열두 줄 표, 합친 칸 없이 ‘계’ 위에
# ‘소계’를 둔 세 단계 예산표, 합계 아래 한 줄만 적은 ‘계 | 여성’, 위 꼴 두 구획 표, 오전 ㏂)과 짚어야 할 것(‘a1’ 묶음의 계 위에
# ‘A’ 묶음의 소계를 둔 여러 단계 표의 틀린 합계, 한 줄 묶음 다음의 틀린 합계, 한 줄 묶음의 틀린 계, 두 번째 머리 줄에 ‘NA’를
# 둔 표를 옮겨 실은 자릿수, ㎡ 와 m² 로 쓴 면적, 괄호 안의 m², ㏄ 로 쓴 배기량, 줄이 아닌 부가세를 뺀 틀린 합계, 덱에 적힌
# 단위 그대로 보이는 자릿점 섞임)
NA_HEAD = [["구분", cs(2, "2024"), cs(2, "2025")], ["", "NA", "EU", "NA", "EU"]]
SIDE = BODY.replace("left:64px", "left:800px").replace("top:160px", "top:420px").replace("width:1100px", "width:420px")
REVIEW4 = deck([
    text_box(1, "표지", "검토 사례 넷"),
    section(2, "여러 단계 표", table([[rs(7, "A"), rs(3, "a1"), "x", "1"], ["y", "2"], ["계", "3"],
                                     [rs(3, "a2"), "z", "4"], ["w", "5"], ["계", "9"], [cs(2, "소계"), "12"],
                                     [rs(4, "B"), rs(3, "b1"), "p", "1"], ["q", "1"], ["계", "2"], [cs(2, "소계"), "2"],
                                     [cs(3, "합계"), "15"]], ["대", "중", "항목", "값"], top=100)),
    section(3, "한 줄 묶음", table([["A1", "10"], ["A2", "20"], ["계", "30"], ["B1", "5"], ["계", "5"], ["합계", "36"]],
                                  ["구분", "건수"], top=100)
            + table([["합계", "35"], ["계", "30"], ["A1", "10"], ["A2", "20"], ["계", "5"], ["B1", "5"]], ["구분", "건수"],
                    top=420)
            + table([["가1", "10"], ["가2", "20"], ["계", "30"], ["나1", "50"], ["계", "51"]], ["구분", "건수"],
                    top=100).replace("left:64px", "left:800px")),
    section(4, "합계 다음의 총계와 이름", table([["A", "10"], ["B", "20"], ["소계", "30"], ["C", "5"], ["D", "6"], ["소계", "11"],
                                            ["합계", "41"], ["E", "1"], ["F", "2"], ["소계", "3"], ["총계", "44"]],
                                           ["구분", "건수"], top=100)
            + table([["A", "10"], ["B", "20"], ["Other", "5"], ["Total (excl. Other)", "30"]], ["Segment", "Revenue"],
                    top=100).replace("left:64px", "left:800px")
            + table([["Alpha", "120"], ["Delta", "450"], ["Omicron", "900"], ["Total", "1,470"]], ["Variant", "Cases"],
                    top=360).replace("left:64px", "left:800px")),
    section(5, "버림한 큰 수와 단위", table([[f"항목{i}", str(v)] for i, v in enumerate([12, 7, 33, 5, 18, 9, 41, 3, 27, 14, 6, 22])]
                                        + [["합계", "203"]], ["구분", "금액(백만 원)"], top=60)
            + table(NA_HEAD + [["매출", "120.5", "80.2", "130.1", "85.4"], ["비용", "100.3", "70.1", "105.2", "72.0"]],
                    top=100).replace("left:64px", "left:800px")
            + f'<div {SIDE}><div class="tin"><p class="pp">배기량 1,998㏄ · 면적 120㎡ · 설비 용량 1,200㎾</p></div></div>'),
    section(6, "옮겨 실은 표와 단위", table(NA_HEAD + [["매출", "120.5", "80.2", "130.1", "85.4"],
                                                   ["비용", "100.3", "70.1", "105.2", "72"]],
                                          top=100).replace("left:64px", "left:800px")
            + f'<div {SIDE}><div class="tin"><p class="pp">배기량 1,999㏄ · 면적 120.4 m² · 설비 용량 3400㎾</p></div></div>'),
    section(7, "세 단계 예산과 한 줄", table([["- 인건비", "120", "130"], ["- 운영비", "80", "85"], ["계", "200", "215"],
                                          ["- 장비비", "300", "250"], ["- 재료비", "50", "60"], ["계", "350", "310"],
                                          ["소계", "550", "525"], ["- 위탁비", "40", "45"], ["- 여비", "10", "12"], ["계", "50", "57"],
                                          ["소계", "50", "57"], ["합계", "600", "582"]], ["구분", "2024", "2025"], top=40)
            + table([["계", "120", "135"], ["여성", "45", "52"]], ["구분", "2024", "2025"], top=40).replace("left:64px", "left:800px")
            + table([["품목A", "1,000"], ["품목B", "2,000"], ["합계(부가세 제외)", "3,100"]], ["구분", "금액"],
                    top=200).replace("left:64px", "left:800px")
            + f'<div {SIDE}><div class="tin"><p class="pp">부지 면적 820 m² · 개장 10㏂</p></div></div>'),
    section(8, "위 꼴 두 구획", table([["합계", "30"], ["소계", "10"], ["a", "4"], ["b", "6"], ["소계", "20"], ["c", "8"],
                                    ["d", "12"], ["합계", "25"], ["소계", "15"], ["e", "7"], ["f", "8"], ["소계", "10"], ["g", "3"],
                                    ["h", "7"]], ["구분", "건수"], top=40)
            + f'<div {SIDE}><div class="tin"><p class="pp">부지 면적(850 m²) · 개장 11㏂</p></div></div>'),
])
REVIEW4_FINDINGS = [
    ["비용 · 2025 EU — 자릿수가 다릅니다", "72.0(5장) · 72(6장)"],
    ["면적 (m²) — 자릿수가 다릅니다", "120(5장) · 120.4(6장)"],
    ["배기량 (cc) — 장마다 값이 조금 다릅니다", "1,998(5장) · 1,999(6장)"],
    ["부지 면적 (m²) — 장마다 값이 조금 다릅니다", "820(7장) · 850(8장)"],
    ["표의 합계가 맞지 않습니다 — 값", "합계 15 · 위 칸들의 합 14(2장)"],
    ["표의 합계가 맞지 않습니다 — 건수", "합계 36 · 위 칸들의 합 35(3장)"],
    ["표의 합계가 맞지 않습니다 — 건수", "합계 51 · 위 칸 50(3장)"],
    ["표의 합계가 맞지 않습니다 — 금액", "합계 3,100 · 위 칸들의 합 3,000(7장)"],
    ["천 단위 자릿점을 섞어 썼습니다", "네 자리 수 — 자릿점 있음: 1,998㏄(5장) · 1,200㎾(5장) · 1,999㏄(6장) / 없음: 3400㎾(6장)"],
]


def test_number_audit_reads_nested_totals_and_written_units(browser, tmp_path, serve):
    ctx, page, errors = open_deck(browser, tmp_path, serve, "review4", REVIEW4)
    page.click("#tabNum")
    expect(page.locator("#numList li")).to_have_count(len(REVIEW4_FINDINGS))
    assert listed(page) == REVIEW4_FINDINGS
    nums = [[str(s), t, lb] for s, t, lb in page.evaluate(NUMBERS)]
    # ‘Delta’는 변이 이름(자료 줄), 두 번째 머리 줄의 ‘NA’는 같은 줄에 ‘EU’가 있어 머리의 이름(북미)
    assert ["4", "450", "delta · cases"] in nums and ["5", "72.0", "비용 · 2025 eu"] in nums
    ctx.close()
    assert errors == []


def test_number_audit_lists_at_most_300_places(browser, tmp_path, serve):
    many = "".join(table([["가", "1"], ["나", "2"], ["합계", "4"]], ["구분", "건수"], top=160 + (i % 5)) for i in range(305))
    ctx, page, errors = open_deck(browser, tmp_path, serve, "many", deck([section(1, "많은 표", many)]))
    page.click("#tabNum")
    expect(page.locator("#numSum")).to_have_text(
        "숫자 915개를 살펴 305곳을 짚었습니다 — 살펴볼 곳일 뿐 틀렸다는 뜻은 아닙니다.")
    expect(page.locator("#numList li")).to_have_count(300)
    expect(page.locator("#numList p.ix-more")).to_have_text("외 5곳 — 앞의 곳을 고친 뒤 다시 살피면 이어서 보입니다.")
    ctx.close()
    assert errors == []
