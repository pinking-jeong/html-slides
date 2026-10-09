# PDF.js (갤러리의 PDF 재생용)

Mozilla 의 [PDF.js](https://github.com/mozilla/pdf.js) 를 고치지 않고 그대로 담았다. 라이선스: Apache-2.0(`LICENSE`),
`wasm/` 의 디코더는 각 `LICENSE_*`.

- 판: pdfjs-dist **6.4.299** (npm, 2026-10-03 공개, GitHub Actions 출처 증명(SLSA provenance) 있음)
- npm tarball 무결성: `sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`
- GitHub 릴리스 `pdfjs-6.4.299-dist.zip`·`pdfjs-6.4.299-legacy-dist.zip` 과 같은 이름의 파일을 대조해 같음을 확인했다
  (빌드마다 새로 만드는 무작위 값 `INTERNAL_EVT` 한 줄만 다름).
- 파일마다의 SHA-256: `SHA256SUMS`(이 README 는 빠짐) — 이 폴더에서 `sha256sum -c SHA256SUMS` 로 확인한다.
  tarball 의 파일과 바이트까지 같음을 확인해 만들었고, `tests/test_build_manifest.py` 가 늘 대조한다.

| 이 폴더 | pdfjs-dist 의 |
|---|---|
| `pdf.min.mjs`, `pdf.worker.min.mjs` | `legacy/build/` — 조금 오래된 브라우저(Chrome 125+, Safari 18+)까지 받는 빌드 |
| `cmaps/`, `standard_fonts/`, `iccs/` | 같은 이름 폴더 — 글꼴을 넣지 않은 PDF(한·중·일 글자 포함)와 색 관리 |
| `wasm/` | 같은 이름 폴더에서 `quickjs-eval.*`(PDF 안의 스크립트 실행용 — 쓰지 않음)만 뺌 |

## 바꾸는 법

1. `npm view pdfjs-dist version dist.tarball dist.integrity` 로 새 판과 무결성 값을 본다(공개된 지 얼마 안 된 판은 피한다).
2. tarball 을 받아 sha512 를 확인하고, 위 표대로 파일을 바꿔 넣는다(이 폴더를 통째로 지우고 다시 만든다).
3. 이 파일의 판·무결성 값과 `SHA256SUMS`(README·자신을 뺀 모든 파일, `sha256  경로` 꼴)를 새로 쓰고,
   `viewer/pdf.js` 가 쓰는 옵션이 그대로인지 보고, `python -m pytest tests` 와 `slides serve` 로 PDF 덱을 열어 본다.
