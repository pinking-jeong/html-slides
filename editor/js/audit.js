/* 숫자 감사 — 덱의 글(찾기와 같은 글줄)에서 숫자를 모아 어긋나 보이는 곳을 짚는다. 고치지는 않는다 — 장 번호를 누르면 그
   장으로 가서 그 숫자를 형광으로 보인다(찾기와 같은 자리 꼴 {slide, hi, ri, run, start, end}).
   - 자릿수만 다른 같은 값: 이름(바로 앞의 말 — 아래첨자(UF₆)와 질량수(²³⁹Pu)는 이름의 일부, 한 글자·서수·대문자 한 글자 앞말은
     이어서(‘일 매출’·‘2호기 출력’·‘모델 A: 정확도’), 표 칸은 행·열 머리 — 보일 때는 덱에 적힌 꼴로)과 단위(㎾ 는 kW, ㎡·m²·m2 는
     m², ㏄·㎗ 같은 한 글자 단위도)가 같은 수가 반올림하면 같은데 자릿수가 다른 것(0.262 · 0.26, 48% · 48.0% — 옮겨 실은 표에서 셋
     이상이면 한 줄로). 한 덱 안에서는 한 자릿수로 쓰는 것이 좋다.
   - 조금 다른 값: 같은 이름·단위의 수가 서로 다른 장에서 조금(20% 안, 소수는 끝자리 하나) 다른 것 — 장마다 그 이름의 값이
     하나씩일 때만. 크게 다른 값은 대개 다른 것을 가리켜 짚지 않는다. 전·후(22.0 → 52.2)의 앞 값과 범위(53~93%)·구간
     ([−0.25, +0.41])은 빼고, 서로 다른 표의 같은 자리는 맥락(캡션·바로 앞 제목)이 같거나 다른 장에 다시 실은(반올림해 옮긴
     것도) 같은 표일 때만 견준다(자릿수도).
   - 표의 합: 합계·계·총계·소계·Total 줄이 제 묶음의 합과 다른 것 — 합계가 묶음 아래 오는 표는 바로 위 묶음, 위에 오는 표는 바로
     아래 묶음, 합친 칸으로 묶은 묶음(합계 이름 바로 왼쪽의 칸 — 여러 단계 표면 ‘a1’ 묶음의 계, ‘A’ 묶음의 소계)에 계가 하나뿐이면
     그 묶음, 소계가 있는 표의 합계와 제 묶음이 한 줄도 안 되는 합계는 앞 전체 합계 다음의 모든 줄(처음부터의 모든 줄과 맞아도
     맞다 — 합계 41 다음의 총계 44, 위 꼴 표는 아래 묶음이 먼저 — 여러 구획 표의 둘째 합계), 전체 합계로 자르면 묶음이 비는 소계는
     안쪽 합계를 품은 것이라 앞 소계 다음의 모든 줄(합친 칸 없이 ‘계’ 위에 ‘소계’를 둔 표), 제 묶음이 한 줄뿐인 계는 그 줄과
     같으면 맞고(다르면 같은 열에 몫의 합으로 맞는 합계가 있을 때만 그 줄을 알린다 — ‘계 120 | 여성 45’는 아니다), 양 끝에 합계가
     있으면(위 총계와 아래 계) 더 잘 맞는 꼴로(같으면 어긋남이 작은 꼴로). 이웃 묶음과는 견주지 않는다(옮겨 적은 묶음 합계). 같은
     전체를 두 갈래로 나눈 표(성별·연령별)는 갈래마다(한 갈래만 틀리면 그 갈래의 합을 알린다). ‘전체’는 몫의 합이 ±5% 안일
     때만(깔때기 표), ‘그중 …’·평균·증감·차이·전년 대비 줄과 ‘합계(기타 제외)’처럼 표의 다른 줄이나 중복을 뺀 합계(‘합계(부가세
     제외)’는 줄들의 합), 들여 쓴 하위 줄(‘○ 일반회계’ 아래 ‘- 사업1’ — 윗줄이 비었으면 하위 줄을)은 합에 넣지 않고, (30)·△30 처럼
     숫자 하나로 읽지 못한 칸이 든 묶음은 더하지 않는다. 칸 합치기는 눈에 보이는 열대로 맞추고, 머리 줄(두 줄짜리 머리와 단위만
     적은 줄도 — ‘-’ 칸이 든 줄은 자료, 두 줄짜리 머리의 아랫줄에서 같은 줄에 다른 이름이 있는 ‘NA’는 이름)·행 머리 칸은 빼고,
     비율·평균 열과 줄마다의 계(행 백분율 100.0)는 보지 않는다(합계가 100% 이고 몫의 합도 100 근처인 열은 몫). ‘(억 원)’·‘(단위:
     백만)’·‘(천 건)’처럼 큰 수 단위로 적은 정수(표가 하나뿐인 장은 표 밖의 ‘(단위: 억 원)’까지)는 반올림한 것으로 본다(그 열의
     단위면 버림했을 수도 있어 칸마다 반 자리씩 끝까지, 표 전체에 적은 단위는 어느 열의 것인지 몰라 소수·% 칸처럼 칸이 많으면 4σ
     까지). 비중·구성비처럼 나눠 가진 % 열(행은 행 이름이 그런 말일 때, 해마다 적은 것은 빼고)의 합이 100 근처인데 반올림으로
     설명되지 않게 어긋나는 것.
   - 표기 섞임: 단위가 붙은 천 단위 수에서 자릿점(1,234건 · 1234건)을 섞어 쓴 것(px·MB 처럼 늘 자릿점 없이 쓰는 단위는 빼고,
     단위는 덱에 적힌 꼴로 보인다), 표의 한 열(숫자만 든 칸, m² 같은 단위까지)에서 소수 자릿수가 다른 것(줄마다 다른 양을 적은
     지표|값 표와 크기가 열 배 넘게 다른 값들은 빼고).
   보지 않는 숫자 — 날짜·시각·연도·쪽 번호·머리 번호(‘1. 서론’)·위아래 첨자(각주·화학식·질량수)·코드·주소·DOI·인용([23])·이름에
   붙은 번호(U-235·KN-23)·서수(제3호·2위·1분기)·단위 없는 긴 번호(HS 284510)·±오차·지수 표기(2.1×10⁻³)·판·절 번호(Python 3.11·
   Section 4.2·개정 2.1판), 쪽 레이아웃 상자, 단위 없는 작은 정수(‘모델 2’).
   어긋나 보이는 곳일 뿐 틀렸다는 뜻은 아니다. 장마다 읽은 것을 기억해 두고 바뀐 장만 다시 읽는다. */

import { textHosts } from './canvas.js';
import { runsOf } from './find.js';

const ch = (...codes) => String.fromCharCode(...codes);
const span = (a, b) => ch(...Array.from({ length: b - a + 1 }, (_, i) => a + i));
// 숫자로 읽지 않는 글자는 칸막이(SEP — 숫자도 글자도 빈칸도 아닌 제어 글자)로 바꿔 읽는다: 위·아래 첨자 숫자(¹²³⁰⁴…⁹ ₀…₉)와
// 0 폭 글자. 이 파일에 이스케이프로 적으면 편집 도구가 글자로 바꿔 버려 글자 코드로 만든다.
const SEP = ch(0x1F);
const SEPS = new RegExp(SEP, 'g');
const SUP_DIGITS = new RegExp(`[${ch(0xB9, 0xB2, 0xB3, 0x2070)}${span(0x2074, 0x2079)}${span(0x2080, 0x2089)}]`, 'g');
const SUP_RUN = new RegExp(`[${ch(0xB9, 0xB2, 0xB3, 0x2070)}${span(0x2074, 0x2079)}]+`, 'g');
const SUP_CODES = [0x2070, 0xB9, 0xB2, 0xB3, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079];
const supDigits = (s) => s.replace(/\d/g, (d) => ch(SUP_CODES[Number(d)]));
// 이름 속 위첨자 숫자 — 원소 기호 바로 앞이면 질량수(²³⁹Pu), 라틴·그리스 한 글자 바로 뒤면 지수(R²·σ² — ¹ 하나는 각주 ‘A¹’)라
// 남기고, 그 밖(각주 표시 ‘정확도¹’·‘계¹’)은 drop 으로 바꾼다
const SUP_ONE = ch(0xB9);
function supKeep(s, drop) {
  return s.replace(SUP_RUN, (run, i) => {
    if (/[A-Z]/.test(s[i + run.length] || '')) return run;
    if (run !== SUP_ONE && /[\p{Script=Latin}\p{Script=Greek}]/u.test(s[i - 1] || '') && !/\p{L}/u.test(s[i - 2] || '')) return run;
    return drop(run);
  });
}
const ZERO_WIDTH = new RegExp(`[${span(0x200B, 0x200D)}${ch(0x2060, 0xFEFF, 0xAD)}]`, 'g');
const MASK_SEL = 'sup, sub, code, kbd, samp, pre, var';      // 첨자(각주·화학식)·코드 안의 글
const LAYOUT_SEL = '[data-deck-layout], [data-name="pageno"]';

// 숫자 하나 — 부호(앞이 빈칸·괄호일 때만, 줄표 – 도), 자릿점 또는 숫자, 소수, 뒤의 %·%p·‰(빈칸이나 0 폭 글자 하나까지)
const NUM_RE = new RegExp(`(?<![\\p{L}\\p{N}_.,])([-−–+±]?)((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)((?:\\s|${SEP})?(?:%p|%|‰))?(?![\\p{N}])`, 'gu');
// 숫자로 보지 않을 자리
const SKIP_RES = [
  // 지수 표기 2.1×10⁻³ · 5×10^-4(가수와 10 모두 — 위첨자 지수는 이미 칸막이다) · 5e-4
  new RegExp(`(?<![\\p{L}\\p{N}_.])\\d+(?:\\.\\d+)?\\s?[×xX·⋅]\\s?10(?:\\s?\\^\\s?[-−+]?\\d+|[⁻⁺]?${SEP}+|[⁻⁺])`, 'gu'),
  /(?<![\p{L}\p{N}_.])\d+(?:\.\d+)?[eE][-−+]?\d+(?![\p{L}\p{N}])/gu,
  // 판·절 번호 — Section 4.2 · Python 3.11 · Llama 3.1 · 버전 2.0
  /(?<![\p{L}])(?:section|sec\.|chapter|ch\.|version|ver\.|release|python|pytorch|tensorflow|cuda|cudnn|node|java|jdk|ios|android|windows|macos|ubuntu|unicode|html|ecmascript|llama|qwen|mistral|gemini|claude|gpt)\s?-?\d+(?:\.\d+)*/giu,
  /(?:버전|섹션)\s?\d+(?:\.\d+)*/gu,
  /(?<!\d)(?:19|20)\d{2}\s?([-./])\s?\d{1,2}\s?\1\s?\d{1,2}(?:\s?\.)?(?!\d)/gu,   // 2026-10-13 · 2026. 10. 13.
  /(?<!\d)(?:19|20)\d{2}\s?[-./]\s?(?:0[1-9]|1[0-2])(?![\d.])/gu,               // 2026.10 · 2026-03(달은 두 자리)
  /(?<!\d)(?:19|20)\d{2}\s?년(?:\s?\d{1,2}\s?월)?(?:\s?\d{1,2}\s?일)?/gu,         // 2026년 10월 13일
  /(?<![\d.])(?:19|20)\d{2}\s?[~∼～〜–—-]\s?(?:(?:19|20)\d{2}|\d{2})(?![\d.])/gu,   // 기간 2016~2021 · 2022–26
  /(?<!\d)\d{1,2}\s?월(?:\s?\d{1,2}\s?일)?/gu,                                   // 10월 13일 · 3월
  /(?<!\d)\d{1,2}\s?일(?![\p{L}])/gu,                                            // 13일
  /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/gu,                                     // 14:30
  /(?<!\d)\d+\s?\/\s?\d+(?=\s*$)/gu,                                             // 글줄 끝의 쪽 번호 3 / 12
  /(?<![\d.])\d+(?:\.\d+){2,}/gu,                                                // 1.2.3 — 절·판 번호
  /[vV]\d+(?:\.\d+)+/gu,                                                         // v1.2
  /(?:https?:\/\/|www\.)\S+/giu,                                                 // 주소
  /\b10\.\d{4,9}\/\S+/gu,                                                        // DOI
  /\b(?:doi|arxiv|isbn|issn)\s?:?\s?\S+/giu,
  /(?<![%\p{L}\p{N}])pp?\.\s?\d+(?:\s?[-–]\s?\d+)?/gu,                           // 쪽 p. 12 · pp. 123–145(5.2%p. 3 은 아니다)
  /\[\d+(?:\s?[,–-]\s?\d+)*\]/gu,                                                // 인용 [23] · [3, 5–7]
  /(?<![\p{L}])제\s?\d+/gu,                                                       // 제3호 · 제2장 — 서수
];
// 머리 번호 — 글줄 처음의 ‘1.’ ‘2)’ ‘3장’ ‘제4절’ 따위
const HEAD_RE = /^\s*(?:제\s?)?\d+(?:\.\d+)*\s?(?:[.)]|장|절|부|편)(?=\s|$)/u;
// 두 수 사이 — 전·후(앞 값은 옛 값), 범위·견줌·구간(둘 다 한 점의 값이 아니다)
const ARROW_RE = /^\s*(?:→|->|⟶|⇒|=>|➔|➜|⇨|에서)\s*$/u;
const RANGE_RE = /^\s*(?:~|∼|～|〜|–|—|-|‐|‑|to|부터|vs\.?|대)\s*$/iu;
// 이름에 붙은 번호 — 글자 바로 뒤의 이음표(U-235·KN-23·SC/13272·p@10). 쌍점은 이름 뒤 값(‘AP:0.262’)이라 뺀다.
const GLUE = new Set(['-', '‐', '‑', '–', '/', '@', '_']);

// 숫자 뒤의 단위 — 라틴 글자 단위는 아는 것만(kg·MWth·SWU 등), 한국어 단위는 아는 것을 긴 것부터. 조사(‘0.262로’)는 단위가 아니다.
const LATIN_UNITS = new Set(`kg g mg µg ug t kt Mt Gt lb lbs oz MTU tHM tU kgU kgHM km m cm mm µm um nm mi ft ha L l mL ml kL bbl
  W kW MW GW TW Wh kWh MWh GWh TWh MWe MWt MWth GWe GWt GWth kWe J kJ MJ GJ TJ PJ eV keV MeV GeV kcal cal BTU Btu toe Mtoe
  Bq kBq MBq GBq TBq PBq Ci mCi kCi MCi Sv mSv µSv uSv Gy mGy rem mrem SWU kSWU MSWU tSWU s ms µs us ns min h hr hrs d yr yrs
  Hz kHz MHz GHz THz B kB KB MB GB TB PB bit bps kbps Mbps Gbps px pt dpi ppi K °C ℃ °F ° ppm ppb pp mol mmol Pa kPa MPa GPa
  bar mbar atm psi USD KRW EUR JPY CNY bn mn x X × dB dBm mph rpm N kN V kV mV A mA kA Ω σ`.split(/\s+/));
for (const u of [...LATIN_UNITS]) LATIN_UNITS.add(u.normalize('NFKC'));      // 호환 글자를 푼 꼴(µg → μg)도
const LATIN_LOWER = new Set([...LATIN_UNITS].filter((u) => u.length > 2).map((u) => u.toLowerCase()));
// 단위 글자 — ㎡·㎾·㎏ 같은 호환 글자는 풀어서(㎡ → m2 → m), 위첨자 지수(m²·Bq/m³)는 떼고
const unitWord = (w) => w.normalize('NFKC').replace(/(?<=\p{L})[23]$/u, '');
const LAT_RE = new RegExp(`^(\\s?)([A-Za-z${ch(0xB5, 0x3BC)}°℃$€₩${ch(0x2126, 0x3A9)}×σ]+)`, 'u');
// 단위 하나를 한 글자로 쓴 호환 글자(㎾·㎡·㏄·㎗·㍱) — 풀어 쓴 글자가 단위 목록에 없어도 단위다(오전·오후 ㏂·㏘ 와 ㏇·㏍·㏑·㏒ 는
// 아니다)
const COMPAT_SPANS = [[0x3371, 0x337A], [0x3380, 0x33C1], [0x33C3, 0x33C6], [0x33C8, 0x33CC], [0x33CE, 0x33D0], [0x33D3, 0x33D7],
  [0x33D9, 0x33DF]];
const COMPAT_UNIT = new RegExp(`^\\s?[${COMPAT_SPANS.map(([a, b]) => `${ch(a)}-${ch(b)}`).join('')}]`, 'u');
// 넓이·부피 지수(m²·㎡·m2)가 붙는 길이 단위
const EXP_UNITS = new Set(['m', 'cm', 'mm', 'km', 'dm', 'μm', 'um', 'nm', 'ft', 'mi']);
const byLength = (a, b) => b.length - a.length;
const KO_UNITS = ['개국', '개월', '개사', '개소', '시간', '퍼센트', '포인트', '배럴', '킬로그램', '킬로미터', '메가와트', '기가와트',
  '그램', '미터', '리터', '와트', '가지', '마리', '건', '개', '명', '회', '배', '톤', '원', '달러', '억', '만', '천', '조', '년', '분',
  '초', '점', '기', '대', '곳', '주', '편', '종', '척', '발', '번', '일', '국'].sort(byLength);
// 서수 — 수가 아니라 차례(숫자에 붙여 쓴 것만)
const ORD_UNITS = ['번째', '년차', '분기', '반기', '분위', '학기', '학년', '세기', '회차', '주년', '분의', '차', '위', '호', '층', '장',
  '쪽', '절', '항', '권', '등', '판'].sort(byLength);
const NOT_UNITS = ['초과', '만큼', '번호'];
// 단위 뒤에 올 수 있는 것 — 끝·한글 아닌 글자·조사
const PARTICLE_START = /^(?:으로|에서|까지|부터|이며|이고|이다|이었|이나|이라|였|은|는|이|가|을|를|의|에|와|과|로|도|만|씩|쯤|가량|째|당|간|여|내외|정도|이상|이하|미만|안팎|가까이|남짓|께)/u;
const unitEnds = (rest) => !rest || !/^\p{Script=Hangul}/u.test(rest) || PARTICLE_START.test(rest);
const ID = '#id';
const ORD = '#ord';

function unitAfter(raw) {
  const after = raw.normalize('NFKC');   // ㎾ → kW, ㎡ → m2(단위만 돌려주므로 글자 자리는 상관없다)
  const lat = LAT_RE.exec(after);
  if (lat) {
    const w = lat[2];
    const rest = after.slice(lat[0].length);
    // 길이 단위에 바로 붙은 2·3 은 넓이·부피 지수(㎡ → m2, 위첨자 m² 는 unitScan 이 남긴 것)
    const e = EXP_UNITS.has(w) ? /^[23](?!\d)/.exec(rest) : null;
    // 띄어 쓴 한 글자 뒤에 또 수가 오면(‘2021 g +0.76’) 그 글자는 뒤 수의 이름이다
    if (lat[1] && w.length === 1 && !e && /^\s?[-−+]?\d/.test(rest)) return '';
    if (LATIN_UNITS.has(w) || LATIN_LOWER.has(w.toLowerCase()) || COMPAT_UNIT.test(raw)) {
      return e ? w + (e[0] === '2' ? '²' : '³') : w;
    }
    return lat[1] ? '' : ID;              // 숫자에 바로 붙은 모르는 글자(60Co·3D·2nd)는 이름의 일부
  }
  const spaced = /^\s/.test(after);
  const s = after.replace(/^\s/, '');
  if (NOT_UNITS.some((w) => s.startsWith(w))) return '';
  if (!spaced && ORD_UNITS.some((u) => s.startsWith(u) && unitEnds(s.slice(u.length)))) return ORD;
  // 큰 수 단위가 앞에 붙은 단위(3조원·5억 달러·3만명·3천만 원)는 한 단위로 — ‘25억원’과 ‘24만원’은 다른 값이다
  const big = /^([십백천만억조]*[천만억조])\s?/u.exec(s);
  if (big) {
    const rest = s.slice(big[0].length);
    const u = KO_UNITS.find((x) => !SCALES.has(x) && rest.startsWith(x) && unitEnds(rest.slice(x.length)));
    if (u) return big[1] + u;
    if (big[1].length > 1 && unitEnds(rest)) return big[1];
  }
  return KO_UNITS.find((u) => s.startsWith(u) && unitEnds(s.slice(u.length))) || '';
}

// 덱에 적힌 단위 글자(㎾·m²·억 원) — 단위(푼 꼴)를 덮는 가장 짧은 앞부분
function writtenUnit(raw, unit) {
  const s = raw.replace(/^\s/, '');
  const want = unit.normalize('NFKC').replace(/\s/g, '');
  for (let i = 1; i <= s.length; i += 1) {
    if (s.slice(0, i).normalize('NFKC').replace(/\s/g, '').startsWith(want)) return s.slice(0, i);
  }
  return unit;
}

// 단위 읽기용 글(숫자 뒤 30자) — 칸막이는 지우되, 라틴 글자 바로 뒤의 위첨자 2·3(m²·km³·m<sup>2</sup>)은 지수로 남긴다(뒤에
// 숫자가 잇따르거나 같은 위첨자 안에 ‘)’가 오면 각주 ‘2)’)
const EXP_DIGIT = new RegExp(`^[23${ch(0xB2, 0xB3)}]$`);
const EXP_NEXT = new RegExp(`[\\d${ch(0xB2, 0xB3, 0x207E)}]`);
function unitScan(text, scan, end) {
  let out = '';
  for (let i = end; i < Math.min(scan.length, end + 30); i += 1) {
    if (scan[i] !== SEP) out += scan[i];
    else if (EXP_DIGIT.test(text[i]) && /\p{Script=Latin}/u.test(text[i - 1] || '') && !EXP_NEXT.test(text[i + 1] || '')
      && !(text[i + 1] === ')' && scan[i + 1] === SEP)) {
      out += text[i] === '2' || text[i] === ch(0xB2) ? ch(0xB2) : ch(0xB3);
    }
  }
  return out;
}
const SCALES = new Set(['조', '억', '만', '천']);
const SMALL_ID = 20;                 // 단위·%·소수 없는 이 이하의 정수는 번호로 본다(‘모델 2’·‘3개 중 1’)
const YEAR_RE = /^(?:19|20)\d{2}$/;

// 이름으로 쓰지 않는 말 — 너무 흔해 서로 다른 것을 한데 묶는다
const STOP = new Set(['표', '그림', '장', '쪽', '절', '식', '단계', '부록', '제', '약', '총', '각', '및', '등', '그', '이', '위', '아래',
  '예', '사례', '또는', '혹은', '중', '최대', '최소', '평균', '가운데', '이상', '이하', '미만', '초과', '대략', '모두', '각각', '가량',
  '정도', '내외', '무렵', '당', '즉', '곧', '단', '무려', '겨우', '나머지', '최근', '현재', '이후', '이전', '전', '후', '사이', '동안',
  '기준', '대비', '값', '수', '수치', '결과', '경우', '때', '것', '합', '합계', '전체', '약간', '거의', '대해', '대한', '따른', '위해',
  '통해', '의해', '있는', '없는', '된', '한', '하는', '이다', '였다', '했다', '한다', '보다', '까지', '부터', '에서', '으로', 'p', 'n',
  'x', 'k', 'fig', 'table', 'step', 'no', 'vs', 'and', 'or', 'of', 'to', 'by', 'at', 'in', 'on', 'for', 'is', 'was', 'are', 'were',
  'be', 'the', 'a', 'an', 'about', 'approx', 'approximately', 'around', 'over', 'under', 'than', 'from', 'with', 'per', 'only',
  'just', 'all', 'each', 'total', 'top', 'value', 'values']);
// 이름 끝의 조사 — [조사, 떼고 남아야 할 글자 수]. 한 글자 조사 가운데 이름 끝에도 흔한 것(정확도·차이·평가)은 이름이
// 세 글자 넘게 남을 때만 뗀다.
const PARTICLES = [['으로', 1], ['에서', 1], ['까지', 1], ['부터', 1], ['은', 2], ['는', 2], ['을', 2], ['를', 2], ['의', 2],
  ['에', 2], ['와', 2], ['과', 2], ['로', 2], ['도', 3], ['이', 3], ['가', 3], ['만', 3]];
// 띄어 쓴 조사 한 낱말(‘P3 는’) — 이름이 아니라 버린다
const PARTICLE_WORDS = new Set(['은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '로', '으로', '도', '만', '에서', '까지',
  '부터', '이나', '나', '란', '이란']);
const stripParticle = (w) => {
  const hit = PARTICLES.find(([p, min]) => w.endsWith(p) && w.length - p.length >= min);
  return hit ? w.slice(0, -hit[0].length) : w;
};
// 숫자가 든 지표 이름(F1·Top-1·R2·AP50·pass@1) — 숫자가 든 말 가운데 이것만 이름으로 쓴다
const METRIC_RE = /^(?:f[0-9β]|f1-?score|r2|r²|top-?\d+|m?ap\d*|map@\d+|bleu-?\d|rouge-?[12l]|(?:pass|recall|precision|hits|ndcg|mrr|p|r|k)@\d+)$/iu;
const nameWord = (w) => !!w && /\p{L}/u.test(w) && (METRIC_RE.test(w) || (!/\d/.test(w) && !STOP.has(w.toLowerCase())));
// 이름의 두 꼴 — 보일 꼴(덱에 적힌 대소문자 그대로: ²³⁹Pu·AUC·kW)과 견줄 꼴(작은 글자)
const tidy = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 30).trim();
const norm = (s) => tidy(s).toLowerCase();
// 아래첨자 숫자 — 화학식·지표 이름(UF₆·AP₅₀)은 이름의 일부라 남기되 ‘숫자가 든 말’로 치지 않게 아래첨자 글자로
const subDigits = (s) => s.replace(/\d/g, (d) => String.fromCharCode(0x2080 + Number(d)));

// 숫자 앞의 이름 — 같은 글줄에서 바로 앞의 말 하나(짧으면 둘), 문장·괄호를 넘지 않고 조사를 떼고. 숫자가 든 말은 이름이 아니다.
// scan 은 labelScan 의 꼴(위첨자·코드는 칸막이, 아래첨자는 아래첨자 숫자). 돌려주는 이름은 보일 꼴.
function labelBefore(scan, start) {
  let head = scan.slice(Math.max(0, start - 40), start).replace(SEPS, '');
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'), head.lastIndexOf('。'));
  if (cut >= 0) head = head.slice(cut + 1);
  // 낱말마다 앞의 가름 글자 — 빈칸만으로 띄운 두 말만 한 이름으로 잇는다(‘5억 달러 · 매출’의 ‘달러’는 앞 수의 단위)
  const toks = head.replace(/[()（）[\]{}<>「」『』《》〈〉]/gu, ' ').split(/([\s,;·•|/:=：]+)/u);
  const words = [];
  for (let i = 0; i < toks.length; i += 2) {
    const w = toks[i].replace(/^[‘“'"]+/u, '').replace(/[‘’“”'"—–~→.,!?…-]+$/u, '');
    if (w) words.push({ w, gap: i > 0 ? toks[i - 1] : '' });
  }
  while (words.length && PARTICLE_WORDS.has(words[words.length - 1].w)) words.pop();
  if (!words.length) return '';
  const n = words.length;
  const last = stripParticle(words[n - 1].w);
  if (!nameWord(last)) return '';
  // 앞말과 잇는다 — 이름이 짧거나(‘그룹 A 점수’) 앞말이 한 글자(‘일 매출’·‘주 사용자’)·대문자 한 글자(‘모델 A: 정확도’ — 쌍점을
  // 넘어서도)·서수(‘2호기 출력’)일 때. 앞 수에 붙은 단위(‘5억 달러 매출’의 ‘달러’)는 잇지 않는다.
  const spaced = (i) => /^\s+$/u.test(words[i].gap);
  if (n > 1) {
    const prev = stripParticle(words[n - 2].w);
    const ord = /^\d+(?:호기|차|단계|기|호|단|급|번|위|등|층|동|팀|조|반)$/u.test(prev);
    const letter = /^[A-Z]$/.test(prev);
    if (spaced(n - 1) || ((letter || ord) && /^\s*[:：]\s*$/u.test(words[n - 1].gap))) {
      let i = n - 3;                     // 앞말 앞으로 단위(‘억’)가 빈칸으로 이어지는 동안 거슬러 수에 닿는가
      while (i >= 0 && spaced(i + 1) && isUnit(words[i].w)) i -= 1;
      const unitOfNum = isUnit(prev) && i >= 0 && spaced(i + 1) && /\d/.test(words[i].w);
      const short = last.length <= 2 || /^\p{Script=Hangul}$/u.test(prev) || letter || ord;
      if (short && (nameWord(prev) || letter || ord) && !unitOfNum) return tidy(`${prev} ${last}`);
    }
  }
  return tidy(last);
}

// 글줄을 읽을 꼴로 — 첨자·코드 안의 글자와 첨자 숫자·0 폭 글자를 칸막이로(길이는 그대로)
function scanText(run) {
  let text = run.text;
  const masked = run.nodes.filter(({ t }) => t.parentElement && t.parentElement.closest(MASK_SEL));
  if (masked.length) {
    const out = [];
    let at = 0;
    for (const { t, at: a } of masked) {
      out.push(text.slice(at, a), SEP.repeat(t.data.length));
      at = a + t.data.length;
    }
    out.push(text.slice(at));
    text = out.join('');
  }
  return text.replace(SUP_DIGITS, SEP).replace(ZERO_WIDTH, SEP);
}

// 위첨자 요소의 숫자는 위첨자 숫자로(이름 속 질량수·지수를 supKeep 이 가리게), 그 밖의 위첨자·코드 글은 없앨 것
const supText = (m, s, drop) => (m.localName === 'sup' && /^\d+$/.test(s) ? supDigits(s) : drop(s));

// 이름 읽기용 글줄(길이는 그대로) — 아래첨자는 아래첨자 숫자로, 위첨자 숫자는 이름 속의 것(²³⁹Pu·R²)만 남기고, 각주·코드 안의
// 글자는 칸막이로
function labelScan(run) {
  const out = [];
  let at = 0;
  const sep = (s) => SEP.repeat(s.length);
  for (const { t, at: a } of run.nodes) {
    const m = t.parentElement ? t.parentElement.closest(MASK_SEL) : null;
    if (!m) continue;
    out.push(run.text.slice(at, a), m.localName === 'sub' ? subDigits(t.data) : supText(m, t.data, sep));
    at = a + t.data.length;
  }
  out.push(run.text.slice(at));
  return supKeep(out.join(''), sep).replace(ZERO_WIDTH, SEP);
}

// 보지 않을 자리 — 글자마다 표시(겹친 자리를 견주는 데 글줄 길이만큼만 든다). 머리 번호(‘12편’)는 표 칸 밖에서만.
function skipMask(scan, heads) {
  const mask = new Uint8Array(scan.length);
  const mark = (a, b) => mask.fill(1, a, b);
  for (const re of SKIP_RES) for (const m of scan.matchAll(re)) mark(m.index, m.index + m[0].length);
  const h = heads ? HEAD_RE.exec(scan) : null;
  if (h) mark(0, h[0].length);
  return mask;
}
const masked = (mask, a, b) => {
  for (let i = a; i < b; i += 1) if (mask[i]) return true;
  return false;
};

function glued(scan, start, end) {
  const p1 = scan[start - 1] || '';
  const p2 = scan[start - 2] || '';
  const n1 = scan[end] || '';
  const n2 = scan[end + 1] || '';
  if (p1 === '±' || p1 === '#' || p1 === '№') return true;                // ±오차·#3
  if (GLUE.has(p1) && /\p{L}/u.test(p2)) return true;                    // U-235 · KN-23 · SC/13272 · p@10
  if ((p1 === '/' || p1 === ':') && /\d/.test(p2)) return true;          // 3/12 의 12 · 1:2 의 2
  if ((n1 === '/' || n1 === ':') && /\d/.test(n2)) return true;          // 3/12 의 3
  return /[-‐‑_]/.test(n1) && /\p{L}/u.test(n2);                          // 235-U 같은 이름
}

const sigOf = (plain) => plain.replace('.', '').replace(/^0+/, '').length;

/* ---------- 표: 눈에 보이는 칸 격자(칸 합치기를 풀어), 머리 줄 수, 이름 칸 수, 행·열 머리 */

const PLAIN_RE = /^([-−–+]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s?(?:%p|%|‰))?\s?(.*)$/u;
// 자리만 채운 칸 — 값이 없다는 표시(‘-’·‘—’·‘N/A’·‘해당 없음’ — ‘NA’ 는 북미일 수 있어 빼고)
const FILLER_RE = /^(?:[-–—−‐‑·.]+|n\/a|n\.a\.?|없음|해당\s?없음|미상|비공개)$/iu;
const isUnit = (w) => LATIN_UNITS.has(w) || LATIN_LOWER.has(w.toLowerCase()) || KO_UNITS.includes(w);
// 칸 글이 숫자 하나뿐인가(단위·%까지, 단위의 지수 m²·Bq/m³ 도) — 각주 표시·별표는 cellText 가 이미 뗐다
function plainOf(text) {
  const m = PLAIN_RE.exec(text);
  if (!m) return null;
  const rest = m[4].trim();
  if (!rest) return m;
  return !m[3] && rest.split(/[\s/]+/).every((w) => isUnit(unitWord(w))) ? m : null;
}
// 단위만 적은 칸 — ‘(단위)’·‘억 원’·‘(%)’·‘단위: 명’(두 줄짜리 머리의 단위 줄)
function unitNote(s) {
  const w = s.replace(/단위/gu, ' ').replace(/[()[\]（）［］:：,·/]/gu, ' ').trim();
  if (!w) return /단위/u.test(s);
  return w.split(/\s+/u).every((x) => {
    const u = x.replace(/^[십백천만억조]+/u, '');
    return !u || isUnit(unitWord(u)) || /^(?:%p?|‰)$/u.test(u);
  });
}
// 칸 글이 값으로 시작하는가(연도·서수가 아닌) — 머리 줄·이름 칸을 가르는 데 쓴다
function valueLike(text) {
  const m = /^([-−–+]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/u.exec(text);
  if (!m) return false;
  const rest = text.slice(m[0].length);
  if (!m[1] && YEAR_RE.test(m[2]) && !/^\s?%/.test(rest)) return false;
  const u = unitAfter(rest);
  return u !== ORD && u !== ID;
}

// 칸 글 — 위첨자(각주 ‘합계¹⁾’)·코드는 빼고(이름 속 질량수·지수 ²³⁹Pu·R² 는 남기고), 아래첨자(UF₆)는 아래첨자 숫자로 남긴다
const NOTE_MARKS = new RegExp(`[*†‡§¶${ch(0x207D, 0x207E)}]+`, 'g');
function cellText(el) {
  let s = '';
  const w = el.ownerDocument.createTreeWalker(el, 4);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const m = n.parentElement ? n.parentElement.closest(MASK_SEL) : null;
    if (!m) s += n.data;
    else if (m.localName === 'sub') s += subDigits(n.data);
    else s += supText(m, n.data, () => '');
  }
  return supKeep(s, () => '').replace(ZERO_WIDTH, '').replace(NOTE_MARKS, '').replace(/\s+/g, ' ').trim();
}

const uniq = (list) => [...new Set(list.filter(Boolean))];

function tableInfo(table) {
  const rows = Array.from(table.rows);
  const grid = rows.map(() => []);
  const pos = new Map();
  const secEnd = [];                     // 줄 묶음(thead·tbody·tfoot)의 마지막 줄 — rowspan 은 묶음을 넘지 않는다
  for (let r = rows.length - 1; r >= 0; r -= 1) {
    secEnd[r] = r + 1 < rows.length && rows[r + 1].parentElement === rows[r].parentElement ? secEnd[r + 1] : r;
  }
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row.cells) {
      while (grid[r][c]) c += 1;
      const rs = Math.max(1, Math.min(cell.rowSpan === 0 ? Infinity : cell.rowSpan || 1, secEnd[r] - r + 1));
      const cs = Math.max(1, Math.min(cell.colSpan || 1, 1000));
      pos.set(cell, { r, c });
      for (let i = 0; i < rs; i += 1) for (let j = 0; j < cs; j += 1) grid[r + i][c + j] = cell;
      c += cs;
    }
  });
  const width = Math.max(0, ...grid.map((g) => g.length));
  const texts = new Map();
  const text = (cell) => {
    if (!cell) return '';
    if (!texts.has(cell)) texts.set(cell, cellText(cell));
    return texts.get(cell);
  };
  // (r, c) 에서 시작하는 칸 — 위·왼쪽 칸이 합쳐져 덮은 자리면 없음
  const at = (r, c) => {
    const cell = grid[r] && grid[r][c];
    const p = cell ? pos.get(cell) : null;
    return p && p.r === r && p.c === c ? cell : null;
  };
  const first = width >= 2 ? 1 : 0;
  // 머리 줄 — 앞에서부터 thead 의 줄, 모두 th 인 줄, 값이 든 칸이 없는 줄(연도·‘(단위: 억 원)’ 줄 — 자리만 채운 칸 ‘-’이나
  // 둘째 줄부터의 빈칸이 있으면 값이 빈 자료 줄, 다만 열을 합친 위 머리 줄 아래에서 합치지 않은 열 밑의 빈칸·‘-’는 두 줄짜리
  // 머리의 빈자리), 첫 칸이 위 머리 줄에서 내려온 줄(두 줄짜리 머리의 아랫줄 ‘1 | 2 | 3’), 빈 모서리 칸이 열을 합친 위 머리
  // 줄에서 이어지는 줄(모서리를 합치지 않은 두 줄짜리 머리), 단위만 적은 줄(‘(단위) | 억 원 | ’)
  let h = 0;
  const blank = (r, c) => !!at(r, c) && !text(at(r, c));
  const wide = (r) => Array.from(rows[r].cells).some((cell) => (cell.colSpan || 1) > 1);
  while (h < rows.length) {
    const row = rows[h];
    const inHead = !!row.parentElement && row.parentElement.localName === 'thead';
    const allTh = row.cells.length > 0 && Array.from(row.cells).every((c) => c.localName === 'th');
    const under = (c) => {
      const up = h > 0 && wide(h - 1) ? grid[h - 1][c] : null;
      return !!up && (up.colSpan || 1) === 1 && !!text(up) && !valueLike(text(up));
    };
    // ‘NA’는 빈 값 표시지만, 두 줄짜리 머리의 아랫줄(위 줄이 열을 합쳤거나, 모서리가 비고 이름이 겹치지 않는 줄)에서 같은 줄에
    // 다른 이름(‘EU’)이 있으면 머리의 이름(북미)이다
    const names = [];
    for (let c = first; c < width; c += 1) if (text(at(h, c))) names.push(text(at(h, c)));
    const lower = h > 0 && (wide(h - 1) || (blank(h, 0) && new Set(names).size === names.length));
    const named = lower && names.some((s) => !valueLike(s) && !FILLER_RE.test(s) && !/^na$/i.test(s));
    let bare = true;
    for (let c = first; bare && c < width; c += 1) {
      const s = text(at(h, c));
      const na = !named && /^na$/i.test(s);
      if (valueLike(s) || ((FILLER_RE.test(s) || (h > 0 && (blank(h, c) || na))) && !under(c))) bare = false;
    }
    const lead = grid[h][0];
    const spanned = h > 0 && !!lead && pos.get(lead).r < h;
    const corner = h > 0 && blank(h, 0) && blank(h - 1, 0) && wide(h - 1);
    const cells = Array.from(row.cells).map(text);
    const units = h > 0 && cells.some(Boolean) && cells.every((s) => !s || unitNote(s));
    if (!(inHead || allTh || bare || spanned || corner || units)) break;
    h += 1;
  }
  // 이름 칸 — 값이 든 칸이 처음 나오는 열 앞까지(한 열짜리 표는 없음)
  let k = width >= 2 ? width : 0;
  for (let c = 1; c < width && k === width; c += 1) {
    for (let r = h; r < rows.length; r += 1) {
      if (valueLike(text(at(r, c)))) { k = c; break; }
    }
  }
  // 열·줄 이름 — 보일 꼴(colName·rowName)과 견줄 꼴(colHead·rowHead)
  const memo = (f) => {
    const seen = new Map();
    return (i) => {
      if (!seen.has(i)) seen.set(i, f(i));
      return seen.get(i);
    };
  };
  const colName = memo((c) => tidy(uniq(grid.slice(0, h).map((g) => g[c])).map(text).join(' ')));
  const rowName = memo((r) => tidy(uniq((grid[r] || []).slice(0, k)).map(text).join(' ')));
  const colHead = memo((c) => colName(c).toLowerCase());
  const rowHead = memo((r) => rowName(r).toLowerCase());
  // 줄의 종류 — head(머리·몸통 안의 소제목 줄), total(합계), weak(전체 — 깔때기 표에서는 합이 아니다), sub(소계),
  // part(‘그중 …’ — 앞 줄의 일부라 합에 넣지 않는다), stat(평균·최대 — 몫이 아니다), ''(자료)
  const kinds = [];
  // 괄호 속에서 뺀 것(‘합계(기타 제외)’의 기타)이 이 표의 다른 줄 이름이거나 겹친 것(‘중복 제외’)이면 합계가 아니라 통계 줄 —
  // 부가세처럼 줄이 아닌 것을 뺀 합계는 줄들의 합이다
  let labels = null;
  const leftOut = (t) => {
    const inside = (EXCL_RE.exec(t) || [''])[0].toLowerCase();
    if (/중복|duplicat|overlap/u.test(inside)) return true;
    if (!labels) {
      labels = new Set();
      for (let q = h; q < rows.length; q += 1) {
        for (let c = 0; c < Math.max(1, k); c += 1) {
          const s = text(grid[q][c]).replace(/\s+/g, '').toLowerCase();
          if (s.length >= 2 && !/[()]/.test(s) && !/^\d/.test(s)) labels.add(s);
        }
      }
    }
    return [...labels].some((s) => inside.includes(s));
  };
  const kind = (r) => {
    if (kinds[r] !== undefined) return kinds[r];
    let x = r < h ? 'head' : '';
    const cells = Array.from(rows[r].cells);
    if (!x && cells.length && cells.every((c) => c.localName === 'th') && !cells.some((c) => valueLike(text(c)))) x = 'head';
    for (let c = 0; !x && c < Math.max(1, k); c += 1) {
      const raw = text(grid[r][c]);
      const t = raw.replace(/\s+/g, '');
      if ((SUB_RE.test(t) || TOTAL_RE.test(t)) && EXCL_RE.test(t) && leftOut(t)) x = 'stat';
      else if (SUB_RE.test(t)) x = 'sub';
      else if (TOTAL_RE.test(t)) x = 'total';
      else if (WEAK_RE.test(t)) x = 'weak';
      else if (STAT_RE.test(t)) x = 'stat';
      else if (PART_RE.test(raw)) x = 'part';
    }
    kinds[r] = x;
    return x;
  };
  return { table, rows, grid, pos, width, h, k, text, at, colHead, rowHead, colName, rowName, kind, ctx: '', ctxName: '',
    note: false, count: new Map(), plain: new Map(), slide: -1, id: -1 };
}

const SKIP = {};
const totalKind = (x) => x === 'total' || x === 'weak' || x === 'sub';
// 숫자가 든 표 칸 → {T, el, r, c, label} · 머리 줄·이름 칸·(합계 줄이 아닌) th 칸이면 SKIP · 표 밖이면 null.
// 이름은 행 머리와 열 머리를 따로 줄여 잇는다(긴 행 머리가 열 머리를 잘라 먹지 않게).
function cellOf(host, t, tables) {
  const el = t.parentElement ? t.parentElement.closest('td, th') : null;
  if (!el || !(host.contains(el) || el.contains(host))) return null;
  const table = el.closest('table');
  if (!table) return null;
  if (!tables.has(table)) tables.set(table, tableInfo(table));
  const T = tables.get(table);
  const p = T.pos.get(el);
  if (!p || p.r < T.h || (T.k > 0 && p.c < T.k)) return SKIP;
  if (T.k > 0 && el.localName === 'th' && !totalKind(T.kind(p.r))) return SKIP;
  return { T, el, r: p.r, c: p.c, label: [T.rowHead(p.r), T.colHead(p.c)].filter(Boolean).join(' · '),
    name: [T.rowName(p.r), T.colName(p.c)].filter(Boolean).join(' · ') };
}

// 표의 맥락 글 — 캡션, 없으면 장 안에서 표 바로 앞의 제목(h1~h6·제목 칸). 같은 꼴의 표를 장마다 견줄지 가르고(norm 해서),
// 큰 수 단위 표시(‘(단위: 억 원)’)를 찾는다.
const HEAD_SEL = 'h1, h2, h3, h4, h5, h6, [data-name="title"]';
function contextOf(table, slide) {
  const cap = table.caption ? cellText(table.caption) : '';
  if (cap) return cap;
  let best = null;
  for (const el of slide.querySelectorAll(HEAD_SEL)) {
    if (el.contains(table) || table.contains(el)) continue;
    if (!(el.compareDocumentPosition(table) & 4)) break;     // 표가 이 제목 뒤에 있지 않으면 그만
    best = el;
  }
  return best ? cellText(best) : '';
}

/* ---------- 장 하나 읽기(장마다 기억) */

function runNumbers(host, hi, run, ri, tables) {
  const scan = scanText(run);
  const first = run.nodes[0] && run.nodes[0].t.parentElement;
  const mask = skipMask(scan, !(first && first.closest('td, th')));
  let lscan = null;
  let ni = 0;
  const out = [];
  for (const m of scan.matchAll(NUM_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (masked(mask, start, end)) continue;
    const [, sign, digits, pctRaw] = m;
    if (sign === '±' || glued(scan, start, end)) continue;
    const plain = digits.replace(/,/g, '');
    if (/^0\d/.test(plain)) continue;                      // 0,262(소수 쉼표)·007 같은 번호
    const pct = pctRaw ? pctRaw.replace(SEPS, '').trim() : '';
    const prec = plain.includes('.') ? plain.length - plain.indexOf('.') - 1 : 0;
    const tail = unitScan(run.text, scan, end);
    const unit = pct ? '' : unitAfter(tail);
    if (unit === ID || unit === ORD) continue;
    const comma = digits.includes(',');
    const bare = !pct && !unit && !comma && prec === 0;
    if (bare && plain.length >= 5) continue;               // 단위 없는 긴 번호(HS 284510·IMO 8914934·시드)
    // 숫자가 든 글 조각 — 숫자는 앞에서부터 나오므로 조각도 앞으로만 넘긴다
    while (ni + 1 < run.nodes.length && run.nodes[ni + 1].at <= start) ni += 1;
    const nd = run.nodes[ni];
    const node = nd && start >= nd.at && start < nd.at + nd.t.data.length ? nd : null;
    const cell = node ? cellOf(host, node.t, tables) : null;
    if (cell === SKIP) continue;                           // 표의 머리 줄·이름 칸
    const yearish = bare && YEAR_RE.test(plain);
    if (yearish && !cell) continue;                        // 연도
    if (bare && !cell && Number(plain) <= SMALL_ID) continue;   // 번호(‘모델 2’) — 표 칸의 수는 자료라 둔다
    const neg = sign === '-' || sign === '−' || sign === '–';
    const value = Number(plain) * (neg ? -1 : 1);
    if (!Number.isFinite(value)) continue;
    if (!lscan) lscan = labelScan(run);
    const said = labelBefore(lscan, start);
    out.push({
      slide: -1, hi, ri, host, run, start, end, value, neg, plain, digits, prec, sig: sigOf(plain), pct, unit, yearish,
      unitText: unit ? writtenUnit(tail, unit) : '',
      text: m[0].replace(SEPS, '').trim(), hit: m[0], before: run.text.slice(Math.max(0, start - 18), start),
      after: run.text.slice(end, end + 30), label: said ? norm(said) : cell ? cell.label : '', name: said || (cell ? cell.name : ''),
      cell, pair: '', single: false,
    });
  }
  // 이웃한 두 수 — 전·후는 앞 값을 옛 값으로, 범위·견줌·구간은 둘 다 한 점이 아닌 것으로. 뒤 수는 앞 수의 이름을 잇는다.
  for (let i = 1; i < out.length; i += 1) {
    const a = out[i - 1];
    const b = out[i];
    const gap = scan.slice(a.end, b.start).replace(SEPS, '');
    const interval = /^\s*,\s*$/.test(gap) && /[[(]\s*$/.test(scan.slice(Math.max(0, a.start - 3), a.start))
      && /^\s*[\])]/.test(scan.slice(b.end, b.end + 3));
    if (ARROW_RE.test(gap)) {
      a.pair = 'from';
      if (!b.pair) b.pair = 'to';
    } else if (RANGE_RE.test(gap) || interval) {
      a.pair = 'range';
      b.pair = 'range';
    } else continue;
    if (!b.label) {
      b.label = a.label;
      b.name = a.name;
    }
  }
  return out;
}

const CACHE = new WeakMap();            // 장 → {family, shape, hosts, runs, nums, tables}

// 장의 표 꼴 — 글이 같아도 칸을 합치거나 머리 줄을 바꾸면 다시 읽는다
function tableShape(slide) {
  let s = '';
  for (const t of slide.querySelectorAll('table')) {
    s += '|';
    for (const r of t.rows) {
      s += r.parentElement && r.parentElement.localName === 'thead' ? 'h' : 'r';
      for (const c of r.cells) s += `${c.localName === 'th' ? 'H' : 'D'}${c.colSpan}.${c.rowSpan},`;
    }
  }
  return s;
}

// 글 조각마다 첨자·코드 안인가(서식 지우기로 <sup> 만 벗기면 글은 그대로라 이것으로 안다)
const maskSig = (runs) => runs.map((list) => list.map((run) => run.nodes.map(({ t }) => {
  const m = t.parentElement ? t.parentElement.closest(MASK_SEL) : null;
  return m ? (m.localName === 'sub' ? 'b' : 'm') : '-';
}).join('')).join('|')).join('/');

function sameRuns(old, hosts, runs) {
  if (old.hosts.length !== hosts.length) return false;
  for (let i = 0; i < hosts.length; i += 1) {
    if (old.hosts[i] !== hosts[i] || old.runs[i].length !== runs[i].length) return false;
    for (let j = 0; j < runs[i].length; j += 1) {
      const a = old.runs[i][j];
      const b = runs[i][j];
      if (a.text !== b.text || a.nodes.length !== b.nodes.length) return false;
      for (let q = 0; q < a.nodes.length; q += 1) if (a.nodes[q].t !== b.nodes[q].t || a.nodes[q].at !== b.nodes[q].at) return false;
    }
  }
  return true;
}

// fresh: 기억해 둔 것을 쓰지 않고 다시 읽는다(‘다시 살피기’)
function readSlide(slide, family, fresh = false) {
  const hosts = textHosts(slide, family);
  const runs = hosts.map((host) => (host.closest(LAYOUT_SEL) ? [] : runsOf(host)));
  const shape = tableShape(slide);
  const sig = maskSig(runs);
  const old = CACHE.get(slide);
  if (!fresh && old && old.family === family && old.shape === shape && old.sig === sig && sameRuns(old, hosts, runs)) return old;
  const tables = new Map();
  const nums = [];
  const seen = new Set();
  runs.forEach((list, hi) => list.forEach((run, ri) => {
    if (seen.has(run.nodes[0].t)) return;                 // 표 안의 표 — 바깥 칸에서 이미 읽었다
    for (const { t } of run.nodes) seen.add(t);
    nums.push(...runNumbers(hosts[hi], hi, run, ri, tables));
  }));
  // 숫자 하나만 든 표 칸(단위·%·각주 표시까지)만 표의 합·자릿수를 본다
  for (const n of nums) if (n.cell) n.cell.T.count.set(n.cell.el, (n.cell.T.count.get(n.cell.el) || 0) + 1);
  for (const n of nums) {
    if (!n.cell) continue;
    const { T, el } = n.cell;
    if (T.count.get(el) === 1 && plainOf(T.text(el))) {
      n.single = true;
      T.plain.set(el, n);
    }
  }
  // 장에 따로 적은 단위 글(‘(단위: 억 원)’) — 표가 하나뿐인 장이면 그 표의 것(여럿이면 어느 표의 것인지 몰라 쓰지 않는다)
  const boxNote = tables.size === 1 && runs.some((list) => list.some((run) => {
    const s = run.text.trim();
    const el = run.nodes[0] && run.nodes[0].t.parentElement;
    return s.length <= 40 && /^[(（[［]?\s*단위/u.test(s) && SCALE_NOTE.test(s) && !(el && el.closest('td, th, caption'));
  }));
  for (const T of tables.values()) {
    const raw = contextOf(T.table, slide);
    T.ctxName = tidy(raw);
    T.ctx = T.ctxName.toLowerCase();
    T.note = boxNote || SCALE_NOTE.test(raw);
  }
  const entry = { family, shape, sig, hosts, runs, nums, tables: [...tables.values()] };
  CACHE.set(slide, entry);
  return entry;
}

/* ---------- 살피기 */

const unitKey = (n) => n.pct || n.unit.toLowerCase();
const nameOf = (n) => `${n.name}${unitKey(n) ? ` (${n.pct || n.unit})` : ''}`;   // 덱에 적힌 꼴로
const where = (n) => `${n.text}(${n.slide + 1}장)`;
const order = (a, b) => a.slide - b.slide || a.hi - b.hi || a.ri - b.ri || a.start - b.start;
// 글꼴마다 처음 나온 것, 장 차례로
const firsts = (list) => [...new Map([...list].sort(order).reverse().map((n) => [n.text, n])).values()].sort(order);
const MAX_FORMS = 40;                    // 이름 하나에 글꼴이 이보다 많으면 너무 흔한 이름이다
const NEAR = 0.2;                        // 조금 다른 값 — 큰 값의 20% 안

function labelGroups(nums) {
  const groups = new Map();
  for (const n of nums) {
    if (!n.label || n.yearish) continue;
    const key = `${n.label}|${unitKey(n)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  return groups;
}

// 반올림 — 글자 그대로의 10진수로(0.285 를 0.29 로). 부동소수의 0.28499… 에 속지 않게 정수로 센다.
const scaled = (n) => BigInt(n.plain.replace('.', ''));
function roundTo(n, p) {
  const d = 10n ** BigInt(n.prec - p);
  const s = scaled(n);
  return s / d + (2n * (s % d) >= d ? 1n : 0n);
}
// a 가 b 를 반올림한 꼴인가 — 값이 같고 끝의 0 만 다르면(4 · 4.0) 늘, 아니면 a 의 유효 숫자가 둘 이상일 때만(0.3 · 5 같은
// 한 자리 값은 우연히 맞기 쉽다)
function coarser(a, b) {
  if (a.prec >= b.prec || a.neg !== b.neg || roundTo(b, a.prec) !== scaled(a)) return false;
  return a.sig >= 2 || scaled(b) % 10n ** BigInt(b.prec - a.prec) === 0n;
}

function rounds(groups, kin) {
  const out = [];
  for (const all of groups.values()) for (const list of byTable(all, kin)) {
    const forms = new Map();
    for (const n of list) {
      const f = `${n.neg ? '-' : ''}${n.plain}`;
      if (!forms.has(f)) forms.set(f, []);
      forms.get(f).push(n);
    }
    if (forms.size < 2 || forms.size > MAX_FORMS) continue;
    const keys = [...forms.keys()];
    const up = new Map(keys.map((key) => [key, key]));
    const root = (key) => {
      let r = key;
      while (up.get(r) !== r) r = up.get(r);
      return r;
    };
    for (const a of keys) for (const b of keys) if (coarser(forms.get(a)[0], forms.get(b)[0])) up.set(root(b), root(a));
    const comps = new Map();
    for (const key of keys) {
      const r = root(key);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r).push(key);
    }
    for (const ks of comps.values()) {
      if (ks.length < 2) continue;
      const occ = ks.flatMap((key) => forms.get(key)).sort(order);
      out.push({ kind: 'round', title: `${nameOf(occ[0])} — 자릿수가 다릅니다`, detail: firsts(occ).slice(0, 6).map(where).join(' · '),
        occ });
    }
  }
  return out;
}

// 같은 표로 볼 표들 — 맥락(캡션·바로 앞 제목)이 같은 표, 그리고 다른 장에 다시 실은 표(이름이 같은 칸이 셋 이상 겹치고 그
// 반 넘게 값이 같다 — 요약 장에 옮겨 실은 결과표, 반올림해 옮긴 값 0.812 · 0.81 도 같은 값). 0·100%·한 자리 정수나 한 표에
// 세 번 넘게 나오는 값이 같은 것은 증거로 치지 않는다(분기마다 같은 꼴의 표에 0 이 가득한 것). 한 이름이 너무 많은 표에
// 나오면(흔한 꼴) 그 이름으로는 짝을 세지 않는다. → 표마다 대표 표를 돌려주는 함수
const COPY_MIN = 3;
const COPY_MAX = 50;
function sameTables(groups) {
  const up = new Map();
  const root = (T) => {
    let r = T;
    while (up.has(r)) r = up.get(r);
    return r;
  };
  const join = (a, b) => {
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) up.set(rb, ra);
  };
  const byCtx = new Map();
  const times = new Map();               // 표 → Map(값 → 그 표의 칸에 나온 수)
  for (const list of groups.values()) {
    for (const n of list) {
      if (!n.cell) continue;
      const { T } = n.cell;
      if (T.ctx) {
        if (!byCtx.has(T.ctx)) byCtx.set(T.ctx, T);
        join(byCtx.get(T.ctx), T);
      }
      if (!times.has(T)) times.set(T, new Map());
      times.get(T).set(n.value, (times.get(T).get(n.value) || 0) + 1);
    }
  }
  const plainSame = (T, n) => n.value === 0 || (n.pct && Math.abs(n.value) === 100) || (n.prec === 0 && Math.abs(n.value) < 10)
    || times.get(T).get(n.value) > 2;
  const pairs = new Map();               // 표 → Map(다른 장의 표 → [겹친 칸 수, 값이 같은 칸 수])
  for (const list of groups.values()) {
    const ns = new Map();                // 표 → 이 이름의 수(한 표에 다른 값이 둘이면 null — 세지 않는다)
    for (const n of list) {
      if (!n.cell) continue;
      const { T } = n.cell;
      if (!ns.has(T)) ns.set(T, n);
      else if (ns.get(T) && ns.get(T).value !== n.value) ns.set(T, null);
    }
    const ts = [...ns].filter(([, n]) => n);
    if (ts.length < 2 || ts.length > COPY_MAX) continue;
    ts.forEach(([a, na], i) => ts.slice(i + 1).forEach(([b, nb]) => {
      if (a.slide === b.slide) return;
      const same = na.value === nb.value || coarser(na, nb) || coarser(nb, na);
      if (same && (plainSame(a, na) || plainSame(b, nb))) return;
      if (!pairs.has(a)) pairs.set(a, new Map());
      const c = pairs.get(a).get(b) || [0, 0];
      c[0] += 1;
      if (same) c[1] += 1;
      pairs.get(a).set(b, c);
    }));
  }
  for (const [a, m] of pairs) for (const [b, [both, same]] of m) if (both >= COPY_MIN && 2 * same > both) join(a, b);
  return root;
}

// 같은 이름의 점들을 견줄 묶음으로 — 표 칸끼리만이면 같은 표로 볼 표끼리만(맥락이 없고 옮겨 실은 것도 아닌 표는 저마다 따로:
// 실험마다 같은 꼴로 만든 표의 같은 자리는 다른 값이다), 글이 섞이면 한데
function byTable(list, kin) {
  if (!list.every((n) => n.cell)) return [list];
  const buckets = new Map();
  for (const n of list) {
    const key = kin(n.cell.T);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(n);
  }
  return [...buckets.values()];
}

function nearMisses(groups, kin) {
  const out = [];
  for (const list of groups.values()) {
    const pts = list.filter((n) => n.pair !== 'from' && n.pair !== 'range').sort(order);
    for (const b of byTable(pts, kin)) {
      const f = nearMiss(b);
      if (f) out.push(f);
    }
  }
  return out;
}

// 같은 이름·단위의 점들(장 차례) → 찾은 곳 또는 null
function nearMiss(pts) {
  const bySlide = new Map();
  for (const n of pts) {
    if (!bySlide.has(n.slide)) bySlide.set(n.slide, new Set());
    bySlide.get(n.slide).add(n.value);
  }
  if (bySlide.size < 2 || [...bySlide.values()].some((v) => v.size > 1)) return null;
  const reps = [...new Map(pts.map((n) => [n.value, n])).values()];
  if (reps.length < 2 || reps.length > 3) return null;
  const lo = Math.min(...reps.map((n) => n.value));
  const hi = Math.max(...reps.map((n) => n.value));
  if (lo <= 0 && hi >= 0) return null;
  // 가까운가 — 큰 값의 20% 안이거나, 소수면 (더 잘게 쓴 쪽의) 끝자리 하나 차이(−0.03 · −0.04; 0.001 · 0.0001 은 아니다)
  const p = Math.max(...reps.map((n) => n.prec));
  const ulp = p > 0 ? 10 ** -p : 0;
  if ((hi - lo) / Math.max(Math.abs(lo), Math.abs(hi)) > NEAR + 1e-9 && hi - lo > ulp + 1e-9) return null;
  // 반올림하면 같은 값끼리뿐이면(자릿수 탓) 앞에서 짚었다
  if (reps.every((a) => reps.every((b) => a === b || coarser(a, b) || coarser(b, a)))) return null;
  return { kind: 'value', title: `${nameOf(pts[0])} — 장마다 값이 조금 다릅니다`,
    detail: firsts(pts).slice(0, 6).map(where).join(' · '), occ: pts };
}

// 합계 줄의 이름 — 괄호를 단 것(‘합계(A+B)’·‘소계(A)’)과 쌍점(‘Total:’)까지
const TOTAL_RE = /^(?:합계|합|계|총계|총합|총합계|전체합계|총|total|sum|grandtotal)(?:\([^()]*\))?[:：]?$/i;
const WEAK_RE = /^(?:전체|overall|all)$/i;           // 전체 — 깔때기·‘그중’ 표에서는 합이 아니다
const SUB_RE = /^(?:소계|subtotal)(?:\([^()]*\))?[:：]?$/i;
// 일부를 뺀 합계(‘합계(기타 제외)’·‘Total (excl. Other)’·‘소계(차감 후)’) — 합계가 아니라 통계 줄로
const EXCL_RE = /\([^()]*(?:제외|빼고|뺀|미포함|불포함|차감|excl|except|without|w\/o|netof)[^()]*\)/i;
// ‘이중’(이중 용도·이중 국적)은 낱말이라 ‘이 중’만
const PART_RE = /^\s*(?:그\s?중|이\s중|그\s?가운데|이\s?가운데|of\s+which|of\s+whom|among\s+(?:them|which)|incl(?:\.|uding)?\s|[└ㄴ↳])/iu;
// 통계·증감 줄(평균·중앙값·표준편차·증감·차이·전년 대비 — 붙여 쓰거나 괄호를 단 ‘전년대비 증감’·‘증감률(%)’·‘YoY (%)’도) — 몫이
// 아니다. ‘증가·감소·변동·최대’처럼 갈래 이름으로도 쓰는 말(응답 ‘증가 | 감소 | 유지’, 금리 ‘고정 | 변동’, 펀드
// ‘Growth | Value’)은 넣지 않는다.
const STAT_RE = /^(?:(?:(?:전년|전기|전월|전분기|전년동기)?대비)?(?:평균|평균값|중앙값|중간값|최댓값|최솟값|최대값|최소값|표준편차|분산|증감|증감액|증감률|증감율|차이|격차)|(?:전년|전기|전월|전분기|전년동기)?대비|전년비|average|avg|mean|median|stdev|std|diff|difference|Δ|yoy|qoq)(?:\(.*\))?$/i;
// 들여 쓴 줄의 단계 — 표시 없음 0, □ 1, ○·ㅇ 2, - 3, · 4. 표시 뒤에 글이 있어야 하고(‘-’ 하나뿐인 칸은 이름), 숫자가 바로
// 붙으면 표시가 아니며(‘-5 이하’), ㅇ 은 빈칸이 뒤따를 때만(‘ㅇㅇ기관’은 이름).
const LEVEL_MARKS = [['□■◆◇', 1], ['○●◦◎ㅇ', 2], ['-–‐‑−―', 3], ['·ㆍ∙•', 4]];
function levelOf(text) {
  const m = /^\s*(\S)(\s*)(.)?/u.exec(text);
  if (!m || !m[3] || (!m[2] && (/\d/.test(m[3]) || m[1] === 'ㅇ'))) return 0;
  const hit = LEVEL_MARKS.find(([marks]) => marks.includes(m[1]));
  return hit ? hit[1] : 0;
}
const RATE_RE = /율|률|평균|지수|점수|최대|최소|중앙값|rate|ratio|avg|average|mean|median|index|score|max|min/i;
// 나눠 가진 몫(비중·구성비) — 낱말째로(‘in-distribution’·‘Mixtral’ 은 아니다), 한국어는 ‘매출비중’처럼 붙여 써도. 분포는
// 머리의 끝말일 때만(‘연령 분포’ — ‘분포 이동 정확도’·‘out of distribution’ 은 아니다).
const SHARE_WORDS = new Set(['비중', '구성비', '구성비율', '점유율', '점유', 'share', 'shares', 'composition', 'breakdown', 'mix']);
const SPREAD_WORDS = new Set(['분포', 'distribution']);
function shareLike(s) {
  const words = String(s || '').toLowerCase().split(/[\s()[\]{}/,·:;|]+/u).map((w) => w.replace(/[%‰]+$/u, '')).filter(Boolean);
  if (words.some((w) => SHARE_WORDS.has(w) || /(?:비중|구성비|점유율)$/u.test(w))) return true;
  const last = words[words.length - 1] || '';
  return (SPREAD_WORDS.has(last) || /.분포$/u.test(last)) && !['of', 'out', '외', '밖'].includes(words[words.length - 2]);
}
// 값 열의 머리가 이런 말이거나 이름 열이 이런 말이면 줄마다 다른 양(하이퍼파라미터|값, 지표|값) — 열의 소수 자릿수를 보지 않는다
const GENERIC_HEAD = /^(?:값|수치|설정|설정값|기본값|결과|내용|비고|value|values|setting|settings|default|result|results|note|notes)$/i;
const KINDS_HEAD = /^(?:지표|항목|측정|척도|변수|파라미터|하이퍼파라미터|설정|metric|metrics|measure|measures|parameter|parameters|hyperparameter|hyperparameters|variable|variables|setting|settings|item|items)$/i;
// 반올림한 수 여럿의 합이 가질 수 있는 어긋남 — 소수·% 인 칸마다 반 자리. 정수는 반올림하지 않은 개수로 보되, 큰 수 단위로
// 적은 열(억 원·백만 달러·천 명)의 정수는 반올림한 것이다(round).
// 소수·% 칸이 많으면 어긋남이 그 끝까지 몰리지 않는다 — 고르게 퍼진 어긋남의 합의 네 표준편차를 넘지 않게(스무 줄이면 반
// 자리 열 개쯤). 이 열을 큰 수 단위로 줄인 정수(round = true)는 버림(절사)이면 한쪽으로 몰리므로 끝까지, 표 전체에 적은
// 단위(round = 'note' — ‘(단위: 억 원, 건)’은 어느 열의 것인지 모른다)의 정수는 소수처럼 4σ 까지.
const half = (n, round = false) => (n.prec > 0 || n.pct || round ? 0.5 * 10 ** -n.prec : 0);
const slack = (items, round = false) => {
  let s = 0;
  let d = 0;
  let q = 0;
  for (const n of items) {
    const x = half(n, round);
    if (n.prec > 0 || n.pct || round === 'note') {
      d += x;
      q += x * x;
    } else s += x;
  }
  return s + Math.min(d, 4 * Math.sqrt(q / 3)) + 1e-9;
};
const sumOf = (items) => items.reduce((s, n) => s + n.value, 0);
// 큰 수 단위로 적었다는 표시 — 괄호 안(단위 목록의 둘째 자리도 ‘(단위: 건, 억 원)’)이나 ‘단위’ 뒤, 또는 그것만 든 칸(‘(억 원)’·
// ‘(백만)’·‘(천 건)’·‘(백만 kWh)’·‘억 원’), 영어는 ‘(USD mn)’·‘($ millions)’·‘($M)’·‘in millions’. 글 속의 ‘조건’·‘조명’·
// ‘조원’·‘천명’과 통화 없는 ‘(m)’(미터)은 아니다.
const SCALE_NOTE = /(?:^|[(（[［,，·/]|단위\s*[:：]?)\s*(?:(?:[십백천]?[만억]|천)\s?(?:원|달러|유로|엔|위안|명|톤|배럴|가구|세대|대|건|개|회|호|척|kwh|kw|mwh|mw|gwh|toe|teu|kl|t)?|조\s?(?:원|달러|유로|엔|위안|kwh|toe)?)\s*(?:$|[)）\]］,;/·])|\(\s*(?:us\s?\$|[$€£¥₩]|usd|krw|eur|jpy|cny|gbp)?\s?(?:thousands?|millions?|billions?|trillions?|mn|bn|mln|bln)\s*\)|\(\s*(?:us\s?\$|[$€£¥₩])\s?(?:k|m|mm|b|mil)\s*\)|\bin\s+(?:thousands|millions|billions|trillions)\b|\b(?:usd|krw|eur|jpy|cny|gbp)\s?(?:mn|bn|mln|bln|millions?|billions?)\b/iu;
const scaledUnit = (n) => /^[십백천만억조]/u.test(n.unit) || /^(?:bn|mn)$/i.test(n.unit);
// 기간 머리(2024·2024년·2025(E)·’24·24년·1분기·2Q24·Q3·상반기·3월) — 기간마다 적은 몫은 더하지 않는다. 뒤에 ‘미만·이상·동안’
// 같은 말이 오면 기간이 아니라 길이다(‘10년 미만’).
const PERIOD_RE = /^(?:(?:19|20)\d{2}(?:년도?|[epf]|\([epf]\))?|['‘’]?\d{2}년|['‘’]\d{2}|fy\s?\d{2,4}|[1-4]q(?:\d{2})?|q[1-4]|[1-4]\s?분기|상반기|하반기|h[12]|\d{1,2}\s?월)$/iu;
const SPAN_AFTER = /^(?:미만|이상|이하|초과|이내|간|동안|째|차|후|전|이전|이후)/u;
const periodic = (heads) => heads.filter((s) => {
  const ws = s.split(/\s+/u);
  return ws.some((w, i) => PERIOD_RE.test(w) && !SPAN_AFTER.test(ws[i + 1] || ''));
}).length >= 2;
// 몫이 차례대로 target 에 맞는 묶음 여럿(묶음마다 두 줄 넘게)으로 나뉘는가 — 성별 두 줄 + 연령별 세 줄처럼 같은 전체를 두
// 갈래로 나눈 표. extra 는 target 쪽의 어긋남(합계 칸의 반 자리).
function splits(items, target, round, extra) {
  let run = 0;
  let sl = 0;
  let count = 0;
  let blocks = 0;
  for (const n of items) {
    run += n.value;
    sl += half(n, round);
    count += 1;
    if (count >= 2 && Math.abs(run - target) <= sl + extra + 1e-9 * (1 + Math.abs(target))) {
      blocks += 1;
      run = 0;
      sl = 0;
      count = 0;
    }
  }
  return blocks >= 2 && count === 0;
}
// 갈래 하나만 어긋난 두 갈래 표 — 끝(또는 앞)에서부터 target 에 맞는 묶음을 떼어 내고 남은 한 묶음(두 줄 넘게, target 의 10% 안)
function restBlock(items, target, round, extra) {
  for (const arr of [[...items].reverse(), items]) {
    let run = 0;
    let sl = 0;
    let count = 0;
    let used = 0;
    for (let i = 0; i < arr.length; i += 1) {
      run += arr[i].value;
      sl += half(arr[i], round);
      count += 1;
      if (count >= 2 && Math.abs(run - target) <= sl + extra + 1e-9 * (1 + Math.abs(target))) {
        used = i + 1;
        run = 0;
        sl = 0;
        count = 0;
      }
    }
    const rest = arr.slice(used);
    if (used > 0 && rest.length >= 2 && target !== 0 && Math.abs(sumOf(rest) / target - 1) <= 0.1) return rest;
  }
  return null;
}
// 보일 합 — 몫의 자릿수대로(끝의 0 까지), 합계 칸처럼 자릿점(comma)과 빼기 표시(–·−·-)를 맞춰
const shown = (v, p, minus = '−', comma = false) => {
  const s = v.toFixed(p).replace(/^-/, minus);
  return comma ? s.replace(/\d+/, (d) => d.replace(/\B(?=(\d{3})+$)/g, ',')) : s;
};

function tableChecks(T) {
  const out = [];
  const { rows, h, k, width } = T;
  const slide = T.slide + 1;
  const num = (r, c) => {
    const el = T.at(r, c);
    return el ? T.plain.get(el) || null : null;
  };
  // 숫자를 읽었지만 숫자 하나뿐인 칸이 아닌 칸((30)·△30·10 (5%)) — 그런 칸이 든 몫은 더해 보지 않는다(날짜 ‘1월’처럼 읽지 않은
  // 숫자는 상관없다)
  const odd = (r, c) => {
    const el = T.at(r, c);
    return !!el && (T.count.get(el) || 0) > 0 && !T.plain.has(el);
  };
  const kinds = rows.map((_, r) => T.kind(r));
  const body = [...rows.keys()].filter((r) => kinds[r] === '');
  const data = Math.max(1, k);
  // 들여 쓴 줄의 단계 — 첫 열의 칸(여러 줄을 합친 칸이면 그 칸)의 표시로, 첫 열이 표시 없는 묶음 이름(여러 줄을 합친 칸)이나
  // 빈칸이면 안쪽 이름 열의 표시로(‘일반회계’ 묶음 안의 ‘○ 사업A’·‘- 세부1’)
  const level = rows.map((_, r) => {
    const g = T.grid[r][0];
    const v0 = levelOf(T.text(g));
    if (v0 || !g || ((g.rowSpan || 1) < 2 && T.text(g))) return v0;
    for (let c = data - 1; c >= 1; c -= 1) {
      const v = levelOf(T.text(T.grid[r][c]));
      if (v) return v;
    }
    return 0;
  });
  // 더할 줄 — 표시가 더 깊은 아랫줄들(‘○ 일반회계’ 아래 ‘- 사업1’, ‘국내 매체’ 아래 ‘- 국영’)은 윗줄에 든 것이라 윗줄만,
  // 윗줄이 비었으면 아랫줄을 더한다. loose: 표시 없는 윗줄 아래의 아랫줄(○·● — ‘-’·‘·’ 하위 줄은 아니다)이 그 값과 합이
  // 다르면 그냥 글머리표일 수도 있어 둘 다 더해 본다(‘해외 50’ 아래 ‘● 신규 30’).
  const fits = (top, items, rnd) => items.length > 0 && items.every(Boolean)
    && Math.abs(sumOf(items) - top.value) <= slack(items, rnd) + half(top, rnd) + 1e-9 * Math.abs(top.value);
  const tops = (list, c, rnd, loose) => {
    const out2 = [];
    for (let i = 0; i < list.length;) {
      const r = list[i];
      let j = i + 1;
      while (j < list.length && level[list[j]] > level[r]) j += 1;
      if (j > i + 1) {
        const kids = tops(list.slice(i + 1, j), c, rnd, loose);
        const pv = num(r, c);
        if (!pv && !odd(r, c)) out2.push(...kids);
        else if (!loose || level[r] > 0 || list.slice(i + 1, j).every((x) => level[x] >= 3)
          || (pv && fits(pv, kids.map((x) => num(x, c)), rnd))) out2.push(r);
        else out2.push(r, ...kids);
      } else out2.push(r);
      i = j;
    }
    return out2;
  };
  // 합계 줄마다 견줄 묶음 하나 — 다른 묶음과는 견주지 않는다(옮겨 적은 묶음 합계가 이웃 묶음과 우연히 맞아도 짚게).
  // 합계 이름 왼쪽에서 가장 가까운, 여러 줄을 합친 칸(묶음 이름)에 그 열에 이름을 둔 합계가 하나뿐이면 그 묶음의 자료 줄 —
  // 이름이 오른쪽에 있을수록 안쪽 단계(‘a1’ 묶음의 ‘계’ → ‘A’ 묶음의 ‘소계’ → ‘합계’). 합계가 묶음 가운데 있으면 표 꼴대로 그
  // 위나 아래 줄만.
  // 묶음 합계(소계, 소계가 없으면 합계들)는 표 꼴대로 — 합계가 묶음 위에 오는 표는 바로 아래 묶음, 아니면 바로 위 묶음(맨 아래
  // 합계 뒤의 줄은 덧붙인 줄) — 전체 합계를 넘지 않게. 묶음 합계가 있는 표의 합계와 제 묶음이 한 줄도 안 되는 합계는 전체
  // 합계라 앞 전체 합계 다음의 위(없으면 아래) 모든 자료 줄 — 처음부터의 모든 자료 줄과 맞아도 맞다(합계 41 다음의 총계 44).
  // 제 묶음이 한 줄뿐인 합계는 그 줄과 같으면 맞고(소계는 그 줄하고만 견준다) 전체 합계의 경계가 되지 않는다.
  const totals = [...rows.keys()].filter((r) => totalKind(kinds[r]));
  const totalName = (cell) => {
    const s = T.text(cell).replace(/\s+/g, '');
    return SUB_RE.test(s) || TOTAL_RE.test(s) || WEAK_RE.test(s);
  };
  const labelCol = new Map(totals.map((r) => {
    let c = 0;
    while (c < data - 1 && !totalName(T.grid[r][c])) c += 1;
    return [r, c];
  }));
  const group = new Map();
  for (const t of totals) {
    const lc = labelCol.get(t);
    for (let c = lc - 1; c >= 0; c -= 1) {
      const g = T.grid[t][c];
      const span = g ? [...rows.keys()].filter((r) => T.grid[r][c] === g) : [];
      if (span.length < 2) continue;
      if (span.filter((r) => totalKind(kinds[r]) && labelCol.get(r) === lc).length === 1) group.set(t, span);
      break;
    }
  }
  const free = totals.filter((t) => !group.has(t));
  const subs = free.filter((t) => kinds[t] === 'sub');
  const grand = subs.length || group.size ? free.filter((t) => kinds[t] !== 'sub') : [];
  const level1 = free.filter((t) => !grand.includes(t));
  const between = (a, b) => body.filter((r) => r > a && r < b);
  // 꼴 하나로(top: 합계가 묶음 위) 합계마다 견줄 묶음 → Map(합계 줄 → {place, list, one, all})
  const layout = (top) => {
    const plans = new Map();
    const big = [...grand];
    const ones = new Map();
    level1.forEach((t, i) => {
      let list = top ? between(t, Math.min(level1[i + 1] ?? rows.length, ...grand.filter((g) => g > t)))
        : between(Math.max(level1[i - 1] ?? -1, ...grand.filter((g) => g < t)), t);
      // 전체 합계로 자른 묶음이 비면 그 사이의 합계는 안쪽 단계(‘계’ 위의 ‘소계’) — 앞(위 꼴은 다음) 묶음 합계까지의 모든 줄
      if (!list.length) list = top ? between(t, level1[i + 1] ?? rows.length) : between(level1[i - 1] ?? -1, t);
      if (list.length >= 2) plans.set(t, { place: top ? '아래' : '위', list, one: -1, all: null });
      else {
        big.push(t);
        if (list.length === 1) ones.set(t, list[0]);
      }
    });
    // 전체 합계 — 위 꼴 표는 아래 묶음이 먼저(여러 구획 표의 둘째 합계·여러 단계 표의 안쪽 ‘계’), 아니면 위 묶음이 먼저.
    // 둘 다 비면 위 꼴은 아래, 아니면 위의 모든 줄
    const bounds = big.filter((t) => !ones.has(t)).sort((a, b) => a - b);
    for (const t of big) {
      const prev = bounds.filter((b) => b < t).pop() ?? -1;
      const next = bounds.find((b) => b > t) ?? rows.length;
      const up = between(prev, t);
      const down = between(t, next);
      const one = ones.has(t) ? ones.get(t) : -1;
      const onward = next < rows.length ? between(t, rows.length) : null;
      if (top && down.length) plans.set(t, { place: '아래', list: down, one, all: onward });
      else if (up.length) plans.set(t, { place: '위', list: up, one, all: prev >= 0 ? between(-1, t) : null });
      else if (down.length) plans.set(t, { place: '아래', list: down, one, all: null });
      else plans.set(t, { place: top ? '아래' : '위', list: top ? between(t, rows.length) : between(-1, t), one, all: null });
    }
    for (const [t, span] of group) {
      const rest = span.filter((r) => kinds[r] === '');
      const above = rest.filter((r) => r < t);
      const below = rest.filter((r) => r > t);
      const upper = !below.length || (above.length > 0 && !top);
      plans.set(t, { place: upper ? '위' : '아래', list: upper ? above : below, one: -1, all: null });
    }
    return plans;
  };
  // 머리 칸 어디든(모서리 ‘구분(단위: 억 원)’·마지막 열의 단위 줄) ‘단위’와 큰 수 단위가 있으면 표 전체가 큰 수 단위
  const headNote = uniq(T.grid.slice(0, h).flat()).some((cell) => /단위/u.test(T.text(cell)) && SCALE_NOTE.test(T.text(cell)));
  // 열마다 — 몫이 하나라도 숫자 하나로 읽지 못한 칸((30)·△30)이면 더하지 않는다. 몫의 합이 맞거나 합계와 같은 묶음 여럿으로
  // 나뉘면(두 갈래) 맞다. 틀렸으면 같은 합의 묶음 여럿(그 합이 칸 전체의 합보다 합계에 가까울 때)이면 그 묶음 합을, 갈래 하나만
  // 어긋났으면 그 갈래의 합을, 한 줄짜리 묶음이면 그 줄을 알린다 — 같은 열에 몫의 합으로 맞는 합계가 있을 때만(‘계 120 | 여성
  // 45’처럼 합계 아래 한 줄만 적은 표는 그 줄이 몫이 아닐 수 있다). → [{ok, dev(어긋난 비율)} | {ok: false, dev, finding}]
  const verdicts = (plans) => {
    const res = [];
    const sure = new Set();
    for (const t of totals) {
      const { place, list, one, all } = plans.get(t);
      for (let c = data; c < width; c += 1) {
        const total = num(t, c);
        if (!total) continue;
        const head = T.colHead(c);
        // 몫인가 — 머리가 비중·구성비면 몫. 합계가 100% 인 비율·% 열은 몫의 합이 100 근처일 때만 몫으로 본다(‘진척률’ 100%
        // 들의 ‘계 100%’는 몫이 아니다). 그 밖의 비율·평균 열과 % 열은 보지 않는다.
        const named = shareLike(head);
        const hundred = total.pct === '%' && Math.abs(total.value - 100) <= 0.5;
        if (!named && !hundred && (RATE_RE.test(head) || total.pct)) continue;
        const own = uniq(T.grid.slice(0, h).map((g) => g[c])).some((cell) => SCALE_NOTE.test(T.text(cell)));
        const rnd0 = own || scaledUnit(total) || ((T.note || headNote) && 'note');
        // 제 묶음이 한 줄뿐이면 그 줄과 같아도 맞다
        const lone = one >= 0 && !odd(one, c) ? num(one, c) : null;
        const same = !!lone && unitKey(lone) === unitKey(total);
        if (same && fits(total, [lone], scaledUnit(lone) || rnd0)) {
          res.push({ ok: true, dev: 0 });
          continue;
        }
        // 맞는가 — 몫의 합, 같은 전체를 두 갈래로 나눈 묶음들, 빼는 줄이 있는 표(손익)에서 앞 줄들의 결과인 마지막 줄(순이익)을
        // 합계가 되풀이한 것. 몫이 모두 합계와 같은 열(행 백분율의 ‘계 100.0’)과 합계보다 큰 몫이 있는 열은 합이 아니다.
        const judge = (parts) => {
          if (parts.length < 2 || parts.some((r) => odd(r, c))) return null;
          const items2 = parts.map((r) => num(r, c)).filter(Boolean);
          if (items2.length < 2 || items2.length * 2 < parts.length) return null;
          if (items2.some((n) => unitKey(n) !== unitKey(total))) return null;
          if (items2.every((n) => n.value >= 0) && total.value < Math.max(...items2.map((n) => n.value))) return null;
          if (items2.every((n) => n.value === total.value)) return null;
          const rnd2 = items2.some(scaledUnit) || rnd0;
          const sum2 = sumOf(items2);
          const ok = Math.abs(sum2 - total.value) <= slack(items2, rnd2) + half(total, rnd2) + 1e-9 * Math.abs(sum2)
            || splits(items2, total.value, rnd2, half(total, rnd2))
            || (items2.some((n) => n.value < 0) && fits(total, items2.slice(-1), rnd2) && fits(total, items2.slice(0, -1), rnd2));
          return { ok, items: items2, sum: sum2, rnd: rnd2 };
        };
        const tight = judge(tops(list, c, rnd0, false));
        const loose = tight && !tight.ok ? judge(tops(list, c, rnd0, true)) : null;
        const whole = all && !(tight && tight.ok) ? judge(tops(all, c, rnd0, false)) : null;
        if ((tight && tight.ok) || (loose && loose.ok) || (whole && whole.ok)) {
          res.push({ ok: true, dev: 0 });
          sure.add(c);
          continue;
        }
        // 한 줄짜리 묶음의 합계가 그 줄과 다르면 — 소계는 그 줄과, 합계는 그 줄이 위 칸들의 합보다 가까우면 그 줄과 견준다
        const off = (v) => Math.abs(v - total.value);
        const byOne = same && (kinds[t] === 'sub' || !tight || off(lone.value) < off(tight.sum));
        if (!tight && !byOne) continue;
        let items = [lone];
        let got = byOne ? lone.value : tight.sum;
        let how = '칸들의';
        if (!byOne) {
          ({ items } = tight);
          for (let m = 2; m <= Math.min(6, items.length >> 1) && how === '칸들의'; m += 1) {
            if (splits(items, tight.sum / m, tight.rnd, 0) && off(tight.sum / m) < off(tight.sum)) {
              got = tight.sum / m;
              how = '묶음마다의';
            }
          }
          if (how === '칸들의') {
            const rest = restBlock(items, total.value, tight.rnd, half(total, tight.rnd));
            if (rest) {
              got = sumOf(rest);
              how = '묶음 하나의';
            }
          }
        }
        if (!named && hundred && !(got >= 95 && got <= 105)) continue;
        // ‘전체’는 몫의 합이 그 값에 가까울 때만(±5%) — 깔때기(전체 → 1차 통과 → …)의 전체는 합이 아니다
        if (kinds[t] === 'weak' && !(total.value !== 0 && Math.abs(got / total.value - 1) <= 0.05 + 1e-9)) continue;
        const p = Math.max(...items.map((n) => n.prec));
        const minus = [total, ...items].map((n) => (n.neg ? n.text[0] : '')).find(Boolean) || '−';
        const what = kinds[t] === 'sub' ? '소계' : '합계';
        const said = byOne ? `${one < t ? '위' : '아래'} 칸 ${lone.text}`
          : `${place} ${how} 합 ${shown(got, p, minus, total.digits.includes(','))}`;
        res.push({ ok: false, dev: Math.abs(got - total.value) / Math.max(1, Math.abs(total.value)), col: byOne ? c : -1,
          finding: { kind: 'sum', title: `표의 ${what}가 맞지 않습니다 — ${T.colName(c) || `${c + 1}번째 열`}`,
            detail: `${what} ${total.text} · ${said}${total.pct}(${slide}장)`, occ: [...items, total] } });
      }
    }
    return res.filter((v) => v.ok || v.col < 0 || sure.has(v.col));
  };
  // 표 꼴 — 첫 묶음 합계 위에 자료 줄이 없으면 합계가 묶음 위에 오는 표. 양 끝에 합계가 있어(위 총계 + 묶음 아래 계, 묶음 위
  // 계 + 아래 총계) 가르기 어려우면 두 꼴 가운데 더 많이 맞는 꼴로(같으면 어긋남이 작은 꼴로).
  const onTop = level1.length > 0 && !body.some((r) => r < level1[0]);
  const atEnd = level1.length > 0 && !body.some((r) => r > level1[level1.length - 1]);
  const score = (vs) => [vs.filter((v) => v.ok).length, -vs.reduce((s, v) => s + v.dev, 0)];
  let judged = verdicts(layout(onTop));
  if (onTop && atEnd && level1.length >= 3) {
    const alt = verdicts(layout(false));
    const [a1, a2] = score(alt);
    const [j1, j2] = score(judged);
    if (a1 > j1 || (a1 === j1 && a2 > j2 + 1e-9)) judged = alt;
  }
  for (const v of judged) if (!v.ok) out.push(v.finding);
  // 나눠 가진 몫(% 열·행)의 합 — 합계 줄이 없는 표에서. 열은 머리가 비중·구성비 같은 말일 때, 행은 행 이름이 그럴 때만
  // (‘2024 비중 | 2025 비중’ 의 한 줄은 두 해의 몫이라 더하지 않는다). 줄·열이 기간(2024 | 2025)이면 해마다의 몫이라 더하지 않는다.
  const shareSum = (items, title) => {
    if (items.length < 2 || !items.every((n) => n.pct === '%')) return;
    const sum = items.reduce((s, n) => s + n.value, 0);
    if (sum >= 95 && sum <= 105 && Math.abs(sum - 100) > slack(items)) {
      const p = Math.max(...items.map((n) => n.prec));
      out.push({ kind: 'sum', title, detail: `합 ${shown(sum, p)}%(${slide}장)`, occ: items });
    }
  };
  if (!totals.length) {
    const byYear = periodic(body.map((r) => T.rowHead(r)));
    for (let c = data; c < width && !byYear; c += 1) {
      const head = T.colHead(c);
      if (shareLike(head)) shareSum(body.map((r) => num(r, c)).filter(Boolean), `% 열의 합이 100 이 아닙니다 — ${T.colName(c)}`);
    }
    for (const r of body) {
      const name = T.rowHead(r);
      if (!shareLike(name)) continue;
      const cols = [];
      for (let c = data; c < width; c += 1) if (num(r, c)) cols.push(c);
      if (periodic(cols.map((c) => T.colHead(c)))) continue;
      shareSum(cols.map((c) => num(r, c)), `% 행의 합이 100 이 아닙니다 — ${T.rowName(r)}`);
    }
  }
  // 한 열(숫자만 든 칸)의 소수 자릿수 — 줄마다 다른 양을 적은 표(지표|값·평가 지표|모델 A)와 크기가 열 배 넘게 다른 값들(정확도
  // 0.81 · 지연 12.5)은 빼고
  const corner = T.colHead(0);
  const kv = k > 0 && (KINDS_HEAD.test(corner.replace(/\s+/g, '')) || corner.split(/[\s·/()]+/u).some((w) => KINDS_HEAD.test(w))
    || /(?:지표|항목|변수|파라미터)$/u.test(corner.replace(/\s+/g, '')));
  for (let c = data; c < width && !kv; c += 1) {
    const head = T.colHead(c);
    if (!head || GENERIC_HEAD.test(head.replace(/\s+/g, ''))) continue;
    const byUnit = new Map();
    for (let r = h; r < rows.length; r += 1) {
      const n = num(r, c);
      if (!n || n.prec === 0) continue;
      if (!byUnit.has(unitKey(n))) byUnit.set(unitKey(n), []);
      byUnit.get(unitKey(n)).push(n);
    }
    for (const list of byUnit.values()) {
      if (list.length < 3 || new Set(list.map((n) => n.prec)).size < 2) continue;
      const mags = list.map((n) => Math.abs(n.value)).filter((v) => v > 0);
      if (mags.length && Math.max(...mags) >= 10 * Math.min(...mags)) continue;
      out.push({ kind: 'style', title: `표의 한 열에서 소수 자릿수가 다릅니다 — ${T.colName(c)}`,
        detail: `${list.slice(0, 6).map((n) => n.text).join(' · ')}(${slide}장)`, occ: list });
    }
  }
  return out;
}

// 천 단위 자릿점 — 단위가 붙은 정수만(번호·연도·부호는 단위가 없다), 네 자리와 다섯 자리 넘는 것을 따로. 화소·바이트·주파수처럼
// 늘 자릿점 없이 쓰는 단위(1080 px · 2048 MB)는 빼고.
const NO_COMMA = new Set(['px', 'pt', 'dpi', 'ppi', 'b', 'kb', 'mb', 'gb', 'tb', 'pb', 'bit', 'bps', 'kbps', 'mbps', 'gbps', 'hz',
  'khz', 'mhz', 'ghz', 'thz', 'k', 'rpm']);
function thousands(nums) {
  const out = [];
  const big = nums.filter((n) => n.unit && !n.pct && n.prec === 0 && Math.abs(n.value) >= 1000 && !NO_COMMA.has(n.unit.toLowerCase()));
  // 보기는 단위까지(1,234건 · 5,678 kg)
  const ex = (list) => firsts(list).slice(0, 3)
    .map((n) => `${n.text}${/^\s/.test(n.after) ? ' ' : ''}${n.unitText || n.unit}(${n.slide + 1}장)`).join(' · ');
  for (const [size, test] of [['네 자리', (n) => n.plain.length === 4], ['다섯 자리 넘는', (n) => n.plain.length > 4]]) {
    const list = big.filter(test).sort(order);
    const withComma = list.filter((n) => n.digits.includes(','));
    const without = list.filter((n) => !n.digits.includes(','));
    if (!withComma.length || !without.length) continue;
    out.push({ kind: 'style', title: '천 단위 자릿점을 섞어 썼습니다',
      detail: `${size} 수 — 자릿점 있음: ${ex(withComma)} / 없음: ${ex(without)}`, occ: [...withComma, ...without] });
  }
  return out;
}

/* 덱의 숫자들 → [{slide, hi, ri, host, run, start, end, value, text, digits, prec, pct, unit, label, cell, pair, …}] */
export function numbersIn(model) {
  const out = [];
  model.slides.forEach((s, i) => {
    for (const n of readSlide(s, model.family).nums) {
      n.slide = i;
      out.push(n);
    }
  });
  return out;
}

// 같은 표로 이은 표들(다른 장에 반올림해 옮긴 요약표) 사이의 자릿수 지적이 셋 이상이면 하나로 — 칸마다 따로 짚으면 목록이 그것으로
// 덮인다. 오타를 잡는 ‘조금 다른 값’은 그대로 둔다.
function mergeCopies(found) {
  const keyOf = (f) => {
    if (!f.occ.every((n) => n.cell)) return '';
    const ids = [...new Set(f.occ.map((n) => n.cell.T.id))].sort((a, b) => a - b);
    return ids.length >= 2 ? ids.join(',') : '';
  };
  const by = new Map();
  for (const f of found) {
    const key = keyOf(f);
    if (!key) continue;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(f);
  }
  const out = [];
  const done = new Set();
  for (const f of found) {
    const key = keyOf(f);
    const list = key ? by.get(key) : null;
    if (!list || list.length < 3) {
      out.push(f);
      continue;
    }
    if (done.has(key)) continue;
    done.add(key);
    const occ = list.flatMap((g) => g.occ).sort(order);
    const T0 = occ[0].cell.T;
    const heads = uniq(occ.filter((n) => n.cell.T === T0).map((n) => T0.colName(n.cell.c)).filter(Boolean));
    const name = T0.ctxName || (heads.length ? `${heads.slice(0, 3).join('·')}${heads.length > 3 ? ' 등' : ''}` : '표');
    const ex = list.slice(0, 2).map((g) => firsts(g.occ).slice(0, 2).map(where).join(' · ')).join(' / ');
    out.push({ kind: 'round', title: `옮겨 실은 표의 자릿수가 다릅니다 — ${name}`,
      detail: `${list.length}칸 — ${ex}${list.length > 2 ? ' …' : ''}`, occ });
  }
  return out;
}

/* 덱 전체 감사 → {count: 숫자 수, findings: [{kind, title, detail, occ: [숫자…]}]} — 자릿수·값·합·표기 차례로.
   fresh: 장마다 기억해 둔 것을 쓰지 않고 다시 읽는다(‘다시 살피기’). */
export function auditNumbers(model, { fresh = false } = {}) {
  const nums = [];
  const tables = [];
  model.slides.forEach((s, i) => {
    const e = readSlide(s, model.family, fresh);
    for (const n of e.nums) {
      n.slide = i;
      nums.push(n);
    }
    for (const T of e.tables) {
      T.slide = i;
      T.id = tables.length;
      tables.push(T);
    }
  });
  const groups = labelGroups(nums);
  const kin = sameTables(groups);
  const checked = tables.flatMap(tableChecks);
  const findings = [
    ...mergeCopies(rounds(groups, kin)),
    ...nearMisses(groups, kin),
    ...checked.filter((f) => f.kind === 'sum'),
    ...thousands(nums),
    ...checked.filter((f) => f.kind === 'style'),
  ];
  return { count: nums.length, findings };
}
