# PptxGenJS (편집기의 ‘PPTX 받기’용)

[PptxGenJS](https://github.com/gitbrent/PptxGenJS) 의 브라우저용 묶음을 고치지 않고 그대로 담았다. 라이선스: MIT(`LICENSE`).
묶음 안에는 [JSZip](https://github.com/Stuk/jszip) 3.10.1(MIT 또는 GPLv3 — 여기서는 MIT 로 쓴다)과 그 안의
[pako](https://github.com/nodeca/pako) 1.0.11(MIT)이 들어 있다. 묶음에는 둘의 라이선스 머리말이 빠져 있어 원문을
`LICENSE-jszip.markdown`·`LICENSE-pako` 로 함께 둔다.

- 판: pptxgenjs **4.0.1** (npm, 2025-06-25 빌드)
- npm tarball 무결성: `sha512-TeJISr8wouAuXw4C1F/mC33xbZs/FuEG6nH9FG1Zj+nuPcGMP5YRHl6X+j3HSUnS1f3at6k75ZZXPMZlA5Lj9A==`
- 파일마다의 SHA-256: `SHA256SUMS`(이 README 는 빠짐) — 이 폴더에서 `sha256sum -c SHA256SUMS` 로 확인한다.
  모두 npm 꾸러미의 파일과 바이트까지 같고, `tests/test_build_manifest.py` 가 늘 대조한다.

| 이 폴더 | 원래 파일 |
|---|---|
| `pptxgen.bundle.js` | pptxgenjs 4.0.1 의 `dist/pptxgen.bundle.js` — JSZip 을 함께 묶은 판(전역 `PptxGenJS`·`JSZip`) |
| `LICENSE` | pptxgenjs 4.0.1 의 `LICENSE` |
| `LICENSE-jszip.markdown` | jszip 3.10.1 의 `LICENSE.markdown`(묶음 안의 `JSZip.version` 과 같은 판) |
| `LICENSE-pako` | pako 1.0.11 의 `LICENSE`(jszip 3.10.1 이 쓰는 판) |

편집기(`editor/js/pptx.js`)가 처음 ‘PPTX 받기’를 누를 때만 `<script>` 로 불러온다. 묶음 끝의 소스 맵 주소
(`pptxgen.bundle.js.map`)는 담지 않았다 — 개발자 도구를 열었을 때만 찾으며, 없어도 동작은 같다.

만든 파일은 편집기가 한 번 다듬는다(`tidy`): 4.0.1 은 한 문단의 글 조각마다 `a:pPr` 를 써서 PowerPoint 스키마에 어긋나므로
문단마다 맨 앞의 것 하나만 남기고, 한국어 글꼴에 붙는 중국어 문자 집합 표시를 떼고, 빈 `a:ln` 을 ‘선 없음’으로 적는다.

## 바꾸는 법

1. `npm view pptxgenjs version dist.tarball dist.integrity` 로 새 판과 무결성 값을 본다(공개된 지 얼마 안 된 판은 피한다).
2. tarball 을 받아 sha512 를 확인하고, 위 표대로 파일을 바꿔 넣는다. 묶음 안의 JSZip 판(`JSZip.version`)이 바뀌었으면
   그 판의 jszip 과 그것이 쓰는 pako 의 라이선스 원문도 바꿔 넣는다.
3. 이 파일의 판·무결성 값과 `SHA256SUMS`(README·자신을 뺀 모든 파일, `sha256  경로` 꼴)를 새로 쓰고,
   `python -m pytest tests/test_editor_pptx.py` 로 받은 파일을 확인한다 — 새 판에서도 다듬기(`tidy`)가 필요한지,
   `margin`(글상자는 pt, 표 칸은 첫 값에 따라 pt·인치)과 `rectRadius`(인치)의 단위가 그대로인지도 본다.
