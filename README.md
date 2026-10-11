# html-slides

이 PC 에서 만든 **HTML·PDF·PPTX 발표자료**를 이 저장소에 모아 두고, 갤러리에서 미리 보고 바로 발표하는 곳입니다.
원본을 고치면 저장소와 갤러리가 따라 바뀝니다.

- 갤러리: <https://pinking-jeong.github.io/html-slides/>
- **공개 저장소입니다.** 올린 덱은 누구나 볼 수 있고(갤러리 목록과 저장소에 다 보임), 올릴 때마다 공개 기록으로
  남습니다. 한 번 올린 것은 지울 수 없다고 보세요. 검색 제외(noindex)를 요청해 두지만 보장되지는 않습니다.

## 어떻게 돌아가나

```
원본 HTML·PDF·PPTX (이 PC, 저장소 폴더 밖 어디든)
   │  slides add      ← 처음 한 번
   │  slides watch    ← 켜 두면 저장할 때마다 / slides sync ← 한 번만
   ▼
decks/<폴더>/<이름>.<html|pdf|pptx>  ──push──▶  GitHub  ──Actions──▶  갤러리(GitHub Pages)
                                                 ▲                    목록·첫 장 그림을 새로 만든다(1~2분)
                                웹 업로드(‘올리기’) ┘
```

- 원본은 **저장소 폴더 밖**에 둡니다. 저장소의 `decks/` 는 slides 가 원본을 비춰 두는 거울이라 손으로 고치지 않습니다.
- slides 는 올리기 전에 원격의 새 판을 먼저 받습니다. **slides 가 마지막으로 올린 판이 아닌 것(웹 업로드·되돌림·직접 수정)은
  덮지 않고 알려 주고, 저장소에서 지워진 덱(웹에서 지움·다른 PC 에서 내림)은 되살리지 않습니다** — 원본으로 다시 올리려면
  안내대로 `slides add … --force`.
- 커밋은 등록한 덱 파일만 골라서 하고, **slides 가 만든 커밋만 올립니다**(만든 커밋의 이름을 `.git` 안에 적어 둠).
  저장소에서 직접 한 커밋이나 slides 의 커밋을 amend·rebase 로 고쳐 쓴 것이 있으면 올리지 않고 알려 주니, 살펴본 뒤
  `git push` 로 직접 올리세요. 지우기는 `slides remove` 로만 합니다.
- 이 PC 와 원격에서 함께 바뀐 파일 가운데 원본이 따로 없는 것(손으로 고친 정보 파일 등)은 어느 쪽도 버리지 않고 멈춘 뒤
  알려 줍니다. 원본이 있는 덱은 원격 쪽을 따르고 알려 줍니다(이 PC 의 원본은 그대로).

## 처음 한 번

- 필요한 것: Python 3.10 이상, git, 이 저장소에 push 할 수 있는 GitHub 로그인.
- 명령은 저장소 폴더에서 씁니다 — PowerShell 은 `.\slides …`(slides.ps1), 명령 프롬프트는 `slides …`(slides.cmd).
  PowerShell 이 스크립트를 막아 두었다면 `.\slides.cmd …` 로 부르되, `&` 가 든 제목은 `--% ` 뒤에 적거나 피하세요.
- 어디서나 `slides` 로 쓰려면 저장소 폴더를 사용자 PATH 에 더합니다(PowerShell, 한 번만):

  ```powershell
  [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$HOME\Documents\html-slides", "User")
  ```

- `slides serve` 로 미리 보기 그림까지 만들려면: `pip install playwright pillow` 후 `python -m playwright install chromium`.
- 다른 PC 에서는 `git clone https://github.com/pinking-jeong/html-slides` 로 받아 씁니다. 원본 경로 기록(등록부)은
  PC 마다 따로라, 그 PC 에서 `slides add` 로 다시 등록합니다.
- 저장소를 새로 만들었다면 Settings → Pages → Source 를 **GitHub Actions** 로 두고(브랜치에서 바로 배포하면
  검색 제외 표시·숨김 처리 없이 저장소가 그대로 공개됩니다), 처음 한 번은 `git push -u origin main` 으로 직접 올립니다.
  slides 는 그다음부터 자기가 만든 커밋만 올립니다.

## 쓰는 법

| 하려는 일 | 명령 |
|---|---|
| 덱을 등록하고 올린다 | `slides add "발표.html" --name my-talk --folder conf --title "발표 제목"` |
| PDF 로 올리고 PPTX 를 붙인다 | `slides add "발표.pdf" --pptx "발표.pptx"` |
| PPTX 만 올린다 | `slides add "발표.pptx"` (10 MB 이하만 갤러리에서 재생) |
| 원본을 고치면 자동으로 올린다 | `slides watch` (켜 둔 동안 저장할 때마다, 8초 더 바뀌지 않으면 올림) |
| 바뀐 것만 한 번 올린다 | `slides sync` |
| 등록한 덱과 상태를 본다 | `slides list` |
| 덱을 내린다 | `slides remove my-talk` (폴더/이름, `decks\…` 경로로 적어도 됨) |
| 등록만 지운다(올린 덱은 둠) | `slides forget my-talk` |
| 이 PC 에서 갤러리를 미리 본다 | `slides serve` (http://127.0.0.1:8765) |
| 갤러리 주소 | `slides url` |

`slides add` 에 함께 붙일 수 있는 것: `--date 2026-10-29`(발표일) · `--venue "학회 이름"` · `--authors "발표자"` ·
`--desc "한두 줄 설명"` · `--tags "핵안보,KG"` · `--pptx "발표.pptx"`(HTML·PDF 덱에 함께 올릴 PPTX — 받기·PowerPoint 로 보기) ·
`--folder-label "학회 발표"`(폴더 표시 이름).
같은 덱을 다시 `add` 하면 원본을 다시 복사하고 적은 정보만 고칩니다. 올릴 때마다 공개 저장소라는 확인을 묻습니다(`--yes` 로 건너뜀).

### PDF·PPTX 덱

- **PDF** 는 갤러리 안의 PDF 뷰어로 바로 재생됩니다. 저장소에 함께 둔 PDF.js 로 그려 바깥 서비스로 보내지 않고,
  글꼴·배치가 원본 그대로라 PowerPoint 덱도 **PDF 로 내보내 올리는 것**이 가장 확실합니다.
  ←/→·PgUp/PgDn·Space 로 넘기고, 숫자 + Enter 로 그 장, Home/End 로 처음·끝, F 로 전체 화면.
- **PPTX** 는 Microsoft Office 웹 뷰어로 재생됩니다. 파일 주소가 Microsoft 로 전달되고 Microsoft 서버가 공개된 파일을
  가져가 그립니다(없는 글꼴은 바뀌고, 애니메이션 일부가 빠질 수 있음). 이 뷰어는 10 MB 가 넘는 파일을 열지 않아
  ([Microsoft Q&A 답변, 2017](https://learn.microsoft.com/en-us/answers/a/10335546) — 공식 문서의 값이 아니라 바뀔 수 있음)
  갤러리도 10 MB(10,000,000 바이트)가 넘는 PPTX 는 재생하지 않고 받기만 둡니다. `slides serve` 의 미리 보기에서도
  재생하지 않습니다(Microsoft 가 이 PC 의 파일을 가져갈 수 없음).
- **PDF + PPTX**: `slides add "발표.pdf" --pptx "발표.pptx"` — PDF 로 재생하고, PPTX 는 카드의 ⋯ 메뉴에
  ‘PowerPoint 로 보기’·‘PPTX 받기’로 붙습니다.
- 이름(확장자를 뺀, 대소문자 무시)이 같은 파일은 한 덱입니다. HTML > PDF > PPTX 차례로 앞의 것이 덱이 되고 뒤의 것은
  그 덱에 붙습니다. `slides add` 는 새 덱이 이름이 같은 다른 덱 밑에 가려지게 되면 멈추고, `slides remove` 는 이름이 같은
  묶음(HTML·PDF·PPTX·정보 파일)을 함께 내립니다.
- 첫 장 그림: PDF 는 갤러리의 뷰어로 그려 찍고, PPTX 는 파일 안에 저장된 미리 보기 그림(`docProps/thumbnail`)을 씁니다
  — 만든 프로그램에 따라 그 그림이 없으면 그림 없이 보입니다.

### 올리기 전 점검

`slides add` 는 올리기 전에 원본을 훑어 보여 줍니다.

- **멈추는 것**: API 키·토큰·개인 키처럼 보이는 글(PDF·PPTX 는 안에 든 글까지, 함께 올리는 PPTX 도).
  잘못 찾은 것이면 `--ignore-scan` 으로 올립니다.
  `watch`·`sync` 도 고친 원본에 이런 글이 새로 생기면 그 덱은 올리지 않고 알립니다.
- **알려 주는 것**: 이 PC 의 파일 경로(`C:\Users\…`)·`file://`·`localhost` 주소·사용자 이름, PPTX 의 만든 이·발표자 노트·메모·바깥 링크.
- **PDF**: 문서 정보(만든 이·주제·키워드)·붙은 파일·스크립트·바깥 링크·암호를 알려 줍니다. 문서 정보와 압축을 푼 흐름까지
  훑지만, **본문 글자는 글꼴에 따라 코드로 들어 있어 다 훑지 못합니다** — 공개해도 되는지 직접 확인하세요.
- **PPTX**: 장·발표자 노트·메모·문서 정보의 XML 과 SVG 그림을 모두 훑고, 만든 이·마지막으로 고친 이·노트 수·
  붙은 파일(차트·표의 원본 엑셀 등 — 그 안은 훑지 않음)·바깥 링크를 알려 줍니다. 깨졌거나 너무 커서 읽지 못한 조각도 알립니다.
- 크기: 50 MB 가 넘으면 알리고, 95 MB 가 넘으면 올리지 않습니다(GitHub 은 100 MB 넘는 파일을 받지 않음).

### 웹에서 올리기

갤러리 오른쪽 위 **올리기** → GitHub 업로드 화면 → 파일을 끌어 놓고 **Commit changes**. 고친 판은 카드의
**⋯ → 새 판 올리기**에서 같은 파일 이름으로 올리면 바뀝니다.

- 저장소 폴더를 통째로 끌어 놓지 마세요(이 PC 에만 두는 파일까지 올라갈 수 있습니다).
- 업로드 링크로 다른 사람도 제안(pull request)을 보낼 수 있습니다. 내가 만들지 않은 덱은 합치지 마세요.
- 웹에서만 올린 덱은 `slides list` 에 나오지 않습니다. 내릴 때는 `slides remove 폴더/이름` 으로 내립니다.

### 첫 화면에서 분류·순서 바꾸기(웹 편집)

갤러리 오른쪽 위 **편집** → 카드를 끌거나 카드의 화살표 단추로 순서를 바꾸고, 카드마다 **분류**를 고릅니다.
**분류 관리**에서 분류를 만들고 이름과 차례를 바꿉니다. 덱 파일은 옮기지 않으므로 분류를 바꿔도 덱 주소는 그대로입니다.
바꾼 배치는 `decks/gallery.json` 하나에 저장되고 1~2분 뒤 모두에게 보입니다. 저장은 저장소 주인만 됩니다.

- **토큰으로 바로 저장(권장)** — 저장 창의 ‘토큰 만들기’가 GitHub 의 fine-grained 토큰 화면을 이름·기한(90일)·권한
  (Contents 읽기·쓰기)을 채워 엽니다. **Repository access 에서 Only select repositories → 이 저장소만** 고르세요.
  토큰은 그 페이지가 열려 있는 동안 메모리에만 두고 브라우저 저장소나 파일 어디에도 적지 않습니다(새로 고치면 다시 넣음).
  다만 입력 칸이 비밀번호 칸이라 브라우저가 비밀번호로 저장할지 물을 수 있습니다 — 저장하지 마세요(저장하면 브라우저 비밀번호 목록에 남음).
  커밋 작성자는 `site.json` 의 `author`(GitHub noreply 주소)라 개인 메일이 남지 않습니다
  (`author` 가 없으면 저장 창이 알리고, GitHub 계정의 메일이 남을 수 있습니다).
- **토큰 없이** — ‘복사하고 GitHub 열기’가 배치 내용을 복사하고 GitHub 편집 화면을 엽니다. 내용을 모두 지우고 붙여 넣은 뒤
  **Commit changes**. 이 길은 GitHub 계정의 기본 메일이 커밋에 남습니다 — GitHub 설정 → Emails 의
  **Keep my email addresses private** 를 켜면 noreply 로 남습니다(웹 업로드도 같음).
- 저장한 뒤 새로 고쳐도 배포가 끝날 때까지(최대 15분) 그 탭은 방금 저장한 배치를 보여 줍니다.
- 이 화면을 연 뒤 다른 곳에서 배치를 저장했으면 덮어쓸지 묻습니다(토큰 없이 저장할 때는 저장 창에 알립니다).
- 숨긴 덱이나 아직 배포되지 않은 덱처럼 이 화면에 없는 덱의 분류·자리는 저장할 때 저장소의 배치 파일에서 그대로
  옮겨 둡니다(토큰 없이 저장할 때는 저장 창을 열 때 읽어 둔 것으로 — 비공개 저장소면 읽지 못해 빠집니다).
- 덱 파일이 든 폴더의 분류는 지울 수 없습니다(지워도 빌드가 다시 붙입니다). 분류 이름은 80글자까지이고,
  HTML 로 풀지 않으므로 적은 그대로 보입니다. **모두 되돌리기**는 편집을 시작한 때로 되돌립니다.
- 정렬의 **정한 순서**가 이 순서입니다. 배치를 저장한 뒤 새로 올린 덱은 맨 앞에 나옵니다(편집에서 옮기면 됨).
- 분류 이름은 `folders.json` 보다 이 파일이 앞섭니다. `slides add --folder-label` 로 정한 이름이 가려지면 slides 가 알려 줍니다.
- 토큰이 새면 그 토큰으로 이 저장소의 파일(갤러리 코드 포함)을 바꿀 수 있습니다. 이 저장소 하나·Contents 권한만 주고
  기한을 짧게 두세요. 의심되면 GitHub 설정 → Developer settings → Personal access tokens 에서 바로 지웁니다.

## 덱 파일 규칙

- `decks/<폴더…>/<이름>.html`(`.pdf`·`.pptx`) — 파일 하나로 된 덱. 폴더는 갤러리의 분류 단추가 됩니다
  (첫 화면 편집으로 덱의 분류를 바꿀 수 있습니다 — 파일은 그 폴더에 그대로).
- `decks/<폴더…>/<이름>/index.html` — 그림·스크립트가 따로 있는 덱(폴더째). 그 폴더 안은 덱의 에셋으로 봅니다.
  그래서 덱 이름을 `index` 로 하면 slides 가 원본 폴더 이름으로 바꿉니다.
- `<이름>.meta.json`(폴더 덱은 그 안의 `meta.json`) — 갤러리에 보일 정보. 모두 선택입니다.

  ```json
  {
    "title": "갤러리에 보일 제목 (없으면 HTML 의 <title>)",
    "description": "한두 줄 설명 (없으면 <meta name=description>)",
    "date": "2026-10-29",
    "venue": "학회·세미나 이름",
    "authors": "발표자",
    "tags": ["꼬리표"],
    "order": 1,
    "hidden": false
  }
  ```

  `order` 를 적은 덱은 맨 앞에 고정됩니다(‘정한 순서’로 볼 때는 첫 화면 편집의 순서가 앞섭니다). `hidden: true` 면 갤러리 목록과 사이트에서 빠지지만, **공개 저장소에는
  그대로 있어 누구나 볼 수 있습니다**(감추기가 아니라 목록에서 빼기). 등록한 덱의 정보 파일을 손으로 고치면
  다음 `sync`·`watch` 가 함께 올립니다. JSON 으로 읽히지 않는 정보 파일은 slides 가 올리지 않고, 사이트도 그 덱을
  뺍니다(숨기려던 덱이 새지 않게 — 고치면 다시 실립니다).
- 이름이 같은 `.pdf`·`.pptx` 는 그 덱에 붙습니다(HTML 덱에는 PDF·PPTX, PDF 덱에는 PPTX — 위 ‘PDF·PPTX 덱’).
  PDF 의 문서 정보, PPTX 의 만든 이·발표자 노트도 함께 공개됩니다.
- `decks/folders.json` — 폴더의 표시 이름과 순서: `{"conf": {"label": "학회 발표", "order": 1}}`.
- `decks/gallery.json` — 첫 화면 편집이 저장하는 배치(손으로 고쳐도 됩니다. slides 는 쓰지 않음):
  `{"categories": [{"key": "conf", "label": "학회 발표"}], "assign": {"덱 id": "분류 키"}, "order": ["덱 id", …]}`.
  덱 id 는 `decks/` 아래 경로에서 확장자를 뺀 것(예: `conf/my-talk`), 분류 키 `""` 는 ‘분류 없음’입니다.
  `categories` 의 차례가 분류 단추의 차례이고, 없는 덱·분류를 가리키는 항목은 무시합니다.
- `_` 나 `.` 로 시작하는 파일·폴더는 덱으로 보지 않고 사이트에도 싣지 않습니다. 커밋했다면 저장소에서는 여전히 보입니다.
- HTML 덱의 장 수와 첫 장 그림은 덱을 실제 브라우저로 열어 셉니다. `.stage .slide.on`·reveal.js·`.slide` 구조를 알아보고,
  모르는 구조면 첫 화면 전체를 찍습니다. PDF·PPTX 는 위 ‘PDF·PPTX 덱’.

## 저장소 구성

```
index.html, assets/          갤러리 화면
viewer/                      PDF 뷰어(pdf.html)·PPTX 뷰어(pptx.html) — 갤러리의 ‘발표’와 미리보기 창이 연다
vendor/pdfjs/                PDF.js 6.4.299(Apache-2.0) — 받은 곳·무결성·바꾸는 법은 그 안의 README.md
decks/                       발표자료 (decks/guide/ 는 사용 안내 견본 — 필요 없으면 slides remove guide/html-slides-guide)
tools/build_manifest.py      목록(decks.json)·첫 장 그림·사이트를 만든다 (Actions 와 slides serve 가 부름)
tools/slides.py              이 PC 의 도구 (slides.ps1·slides.cmd 가 부름)
tools/requirements-ci.txt    Actions 빌드에 쓰는 패키지(버전·해시 고정)
.github/workflows/pages.yml  push 마다 갤러리를 새로 만들어 Pages 에 올린다
site.json                    갤러리 제목·저장소 이름·브랜치·웹 편집 커밋 작성자(author, GitHub noreply 주소만)
tests/                       pytest (python -m pytest tests)
```

이 PC 에만 두는 것(git 에 올라가지 않음): `.git/slides-registry.json`(원본 경로 기록), `.git/slides-commits`(slides 가 만든
커밋 기록), `.site/`·`.thumbcache/`(미리 보기).

## 알아 둘 것

- 올린 것은 지워지지 않는다고 보세요. 내린 덱과 이전 판도 기록에 남고, 완전히 지우려면 기록을 고쳐 쓴 뒤
  GitHub 에 따로 요청해야 하며, 그사이 받아 간 사본은 막을 수 없습니다. 민감한 내용은 올리지 마세요.
  기록을 고쳐 쓰면(force-push) 이 PC 의 slides 는 그것을 알아채고 멈춥니다 — 옛 커밋을 다시 올려 지운 내용이
  되살아나지 않게. 그때 알려 주는 명령으로 이 PC 의 저장소를 원격에 맞추면 됩니다. 저장소를 지우고 다시 만들어
  원격 브랜치가 없어졌을 때도 멈춥니다 — 이 PC 의 기록을 모두 올려도 되면 `git push -u origin main` 으로 직접 올립니다.
  이 PC 에서 올린 커밋을 기록에서 뺄 때(reset 등)도, force-push 하기 전에 slides 가 그 커밋을 원격에서 다시 받아 오지
  않고 멈춥니다 — 알려 주는 대로 `git push --force-with-lease origin main` 으로 원격까지 고치세요.
- `watch` 는 저장할 때마다(올린 뒤 30초 간격으로 묶어) 공개 커밋을 만듭니다.
- 갤러리 사이트의 덱 사본에는 검색 제외 표시가 붙지만, 저장소의 원본 파일은 바이트 그대로 둡니다
  (`.gitattributes` 의 `decks/** -text` — 줄바꿈도 바꾸지 않음). 저장소 화면·원본 파일은 검색될 수 있습니다.
  **PDF·PPTX 파일에는 이 표시를 붙일 수 없어** 사이트의 파일도 검색될 수 있습니다.
- 첫 장 그림은 덱마다 새 브라우저 문맥에서, 크로미엄 샌드박스를 켜고 찍습니다(켤 수 없는 리눅스 러너에서는 끄고 찍는다고
  빌드 기록에 남깁니다). 저장소의 `decks/`·`viewer/`·`vendor/` 만 내주는 임시 서버로 엽니다.
- 갤러리의 미리보기 창은 HTML 덱을 격리해(sandbox) 엽니다. 덱이 브라우저 저장소를 쓰면 미리보기에서는 동작하지 않을 수
  있습니다 — ‘발표’로 열면 됩니다. PDF·PPTX 는 저장소의 뷰어(`viewer/`)로 엽니다.
- 이 저장소에 push 할 수 있으면 `slides` 가 다음에 받아 쓰는 `tools/` 코드도 바꿀 수 있습니다. GitHub 계정에
  2단계 인증을 켜 두세요.
