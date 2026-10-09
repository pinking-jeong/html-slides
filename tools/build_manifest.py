#!/usr/bin/env python3
"""html-slides 사이트 빌더.

decks/ 아래의 HTML 발표자료를 찾아 목록(decks.json)과 첫 장 미리보기 그림을 만들고,
갤러리와 덱을 한 사이트 폴더로 꾸린다. GitHub Actions 가 push 마다 돌리고,
로컬에서는 `slides serve` 가 부른다.

    python tools/build_manifest.py --out _site [--thumbs] [--cache .thumbcache] [--no-git]

덱을 찾는 규칙
- decks/<폴더…>/<이름>.html            → 파일 하나로 된 덱
- decks/<폴더…>/<이름>/index.html      → 여러 파일로 된 덱(그 폴더 안은 에셋으로 본다)
- <이름>.meta.json(폴더 덱은 meta.json) → 제목·설명·발표일·학회·숨김 등을 덮어쓴다
- 같은 이름의 .pptx                     → 내려받기 단추가 붙는다
- decks/folders.json                    → 폴더 키의 표시 이름과 순서
- _ 나 . 로 시작하는 파일·폴더와 바로가기(symlink)는 덱으로 보지 않고 사이트에도 싣지 않는다
- hidden: true 인 덱은 목록에서 빼고 사이트에도 싣지 않는다(공개 저장소에는 그대로 있다)
"""
from __future__ import annotations

import argparse
import datetime as dt
import functools
import hashlib
import html
import http.server
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
DECKS_DIR = "decks"
SITE_FILES = ("index.html",)
SITE_DIRS = ("assets",)
HTML_SUFFIXES = (".html", ".htm")
META_SUFFIX = ".meta.json"
FOLDERS_FILE = "folders.json"
SITE_MARKER = ".html-slides-site"
HEAD_BYTES = 262144                    # <title>·<meta> 는 문서 앞부분에서만 찾는다
THUMB_BOX = (960, 540)                 # 미리보기 그림 최대 크기(16:9)
THUMB_SELECTORS = (                    # 첫 장만 잘라 찍을 요소(앞에서부터 시도)
    ".stage .slide.on", ".stage", ".reveal .slides",
    ".slide.on", ".slide.active", ".slide.current",
)
ROBOTS_META = '<meta name="robots" content="noindex, nofollow">'
BOM = chr(0xFEFF)

TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
META_TAG_RE = re.compile(r"<meta\b[^>]*>", re.I)
ATTR_RE = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
SLIDE_RE = re.compile(r"""<(?:div|section)\b[^>]*\bclass\s*=\s*["'](?:[^"']*\s)?slide(?:\s[^"']*)?["']""", re.I)
HEAD_OPEN_RE = re.compile(r"<head\b[^>]*>", re.I)
HTML_OPEN_RE = re.compile(r"<html\b[^>]*>", re.I)
DOCTYPE_RE = re.compile(r"<!doctype[^>]*>", re.I)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CACHE_NAME_RE = re.compile(r"^[0-9a-f]{16}\.(?:json|webp)$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

PROBE_JS = """() => {
  const q = s => document.querySelectorAll(s).length;
  let n = 0, how = '';
  if (q('.stage .slide')) { n = q('.stage .slide'); how = 'stage'; }
  else if (q('.reveal .slides > section')) { n = q('.reveal .slides > section'); how = 'reveal'; }
  else if (q('section.slide, div.slide')) { n = q('section.slide, div.slide'); how = 'slide'; }
  else if (q('body > section') > 1) { n = q('body > section'); how = 'section'; }
  return { slides: n || null, how: how, title: document.title || '' };
}"""
FONTS_JS = """() => Promise.race([
  document.fonts ? document.fonts.ready.then(() => true) : true,
  new Promise(r => setTimeout(() => r(false), 5000)),
])"""


def log(msg: str) -> None:
    print(msg, flush=True)


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def text_field(meta: dict, key: str) -> str:
    v = meta.get(key)
    return clean_text(str(v)) if isinstance(v, (str, int, float)) and not isinstance(v, bool) else ""


def tags_field(meta: dict) -> list[str]:
    v = meta.get("tags")
    if isinstance(v, str):
        items = v.split(",")
    elif isinstance(v, list):
        items = [x for x in v if isinstance(x, (str, int, float)) and not isinstance(x, bool)]
    else:
        return []
    return [t for t in (clean_text(str(x)) for x in items) if t][:20]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk_files(path: Path):
    """바로가기(symlink)를 따라가지 않고 파일을 훑는다."""
    for cur, dirs, files in os.walk(path):
        dirs.sort()
        for name in sorted(files):
            p = Path(cur) / name
            if not p.is_symlink():
                yield p


def sha256_tree(path: Path) -> str:
    """폴더 덱의 내용 지문 — 상대 경로와 파일 내용을 함께 섞는다."""
    h = hashlib.sha256()
    for p in walk_files(path):
        h.update(p.relative_to(path).as_posix().encode("utf-8"))
        h.update(sha256_file(p).encode("ascii"))
    return h.hexdigest()


def tree_size(path: Path) -> int:
    return sum(p.stat().st_size for p in walk_files(path))


def read_text(path: Path, limit: int | None = None) -> str:
    with open(path, "rb") as f:
        data = f.read(limit) if limit else f.read()
    return data.decode("utf-8", errors="replace")


def extract_title(text: str) -> str:
    m = TITLE_RE.search(text)
    return clean_text(m.group(1)) if m else ""


def extract_description(text: str) -> str:
    for tag in META_TAG_RE.findall(text):
        attrs = {}
        for key, v1, v2, v3 in ATTR_RE.findall(tag):
            attrs[key.lower()] = v1 or v2 or v3 or ""
        name = attrs.get("name", "").lower()
        prop = attrs.get("property", "").lower()
        if name == "description" or prop == "og:description":
            return clean_text(attrs.get("content", ""))
    return ""


def count_slides_heuristic(text: str) -> int | None:
    n = len(SLIDE_RE.findall(text))
    return n or None


def load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log(f"  [경고] {path.name} 을 읽지 못해 무시합니다: {e}")
        return {}
    return data if isinstance(data, dict) else {}


def read_meta(path: Path, quiet: bool = False) -> dict | None:
    """덱의 정보 파일 → dict(없으면 {}). 있는데 JSON 객체로 읽히지 않으면 None — 숨기려던 덱이 새지 않게
    숨긴 것으로 다룬다(고치면 다시 실린다)."""
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        why = "JSON 객체가 아님"
    except (OSError, ValueError) as e:
        data, why = None, str(e)
    if isinstance(data, dict):
        return data
    if not quiet:
        log(f"  [경고] {path.name} 이 JSON 으로 읽히지 않아 이 덱을 사이트에서 뺍니다(고치면 다시 실립니다): {why}")
    return None


def is_hidden(meta: dict | None) -> bool:
    return meta is None or meta.get("hidden") is True


def load_folders(base: Path) -> dict[str, dict]:
    """folders.json — {"conf": "학회 발표"} 또는 {"conf": {"label": "학회 발표", "order": 1}}."""
    out: dict[str, dict] = {}
    for key, val in load_json(base / FOLDERS_FILE).items():
        if isinstance(val, str) and val.strip():
            out[key] = {"label": clean_text(val)}
        elif isinstance(val, dict):
            item = {}
            if isinstance(val.get("label"), str) and val["label"].strip():
                item["label"] = clean_text(val["label"])
            if is_number(val.get("order")):
                item["order"] = val["order"]
            out[key] = item
    return out


def discover(root: Path) -> list[dict]:
    """decks/ 를 훑어 덱 후보를 찾는다(경로·종류만, 내용은 아직 읽지 않음)."""
    base = root / DECKS_DIR
    found: list[dict] = []
    if not base.is_dir():
        return found
    for cur, dirs, files in os.walk(base):
        cur_p = Path(cur)
        dirs[:] = sorted(d for d in dirs if not d.startswith((".", "_")) and not (cur_p / d).is_symlink())
        if cur_p != base and "index.html" in files and not (cur_p / "index.html").is_symlink():
            sidecars = [f for f in files if f.endswith(META_SUFFIX)]
            if sidecars or any((cur_p / d / "index.html").is_file() for d in dirs):
                log(f"  [경고] {cur_p.relative_to(root).as_posix()} 에 index.html 이 있어 폴더째 한 덱으로 봅니다 "
                    "— 그 안의 다른 덱은 목록에 나오지 않습니다")
            found.append({"kind": "dir", "abs": cur_p, "entry": cur_p / "index.html"})
            dirs[:] = []                       # 폴더 덱 안은 에셋 — 더 내려가지 않는다
            continue
        for name in sorted(files):
            p = cur_p / name
            if name.lower().endswith(HTML_SUFFIXES) and not name.startswith((".", "_")) and not p.is_symlink():
                found.append({"kind": "file", "abs": p, "entry": p})
    return found


def git_dates(root: Path, rel: str) -> tuple[str | None, str | None]:
    """(처음 들어온 시각, 마지막으로 바뀐 시각) — git 기록이 없으면 (None, None)."""
    env = {**os.environ, "GIT_LITERAL_PATHSPECS": "1"}     # 파일 이름의 ':' 따위를 pathspec 기호로 읽지 않게

    def run(*args: str) -> str:
        r = subprocess.run(["git", "-c", "core.quotepath=false", "-C", str(root), *args],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
        return r.stdout.strip() if r.returncode == 0 else ""
    updated = run("log", "-1", "--format=%cI", "--", rel) or None
    added = run("log", "--diff-filter=A", "--format=%cI", "--", rel).splitlines()
    created = added[-1] if added else updated
    return created, updated


def describe(root: Path, item: dict, folders: dict[str, dict], use_git: bool) -> dict:
    """덱 하나의 목록 항목을 만든다. hidden 이면 _hidden 표시만 붙인다."""
    base = root / DECKS_DIR
    abs_p: Path = item["abs"]
    entry: Path = item["entry"]
    if item["kind"] == "file":
        name = abs_p.stem
        meta_p = abs_p.with_name(abs_p.stem + META_SUFFIX)
        pptx = abs_p.with_suffix(".pptx")
        pptx = pptx if pptx.is_file() else None
        digest = sha256_file(abs_p)
        size = abs_p.stat().st_size
    else:
        name = abs_p.name
        meta_p = abs_p / "meta.json"
        pptxs = sorted(p for p in abs_p.glob("*.pptx") if not p.is_symlink())
        pptx = pptxs[0] if pptxs else None
        digest = sha256_tree(abs_p)
        size = tree_size(abs_p)
    meta = read_meta(meta_p)
    folder = "/".join(abs_p.parent.relative_to(base).parts)
    rel_entry = entry.relative_to(root).as_posix()
    rel_item = abs_p.relative_to(root).as_posix()
    if is_hidden(meta):
        files = [rel_item] + [p.relative_to(root).as_posix() for p in (meta_p, pptx) if p and p.is_file()]
        return {"_hidden": True, "kind": item["kind"], "files": files, "dir": rel_item}
    head = read_text(entry, HEAD_BYTES)
    created, updated = git_dates(root, rel_item) if use_git else (None, None)
    date = meta.get("date")
    if date is not None and not (isinstance(date, str) and DATE_RE.match(date)):
        log(f"  [경고] {rel_item}: date 는 YYYY-MM-DD 꼴이어야 해서 무시합니다 ({date!r})")
        date = None
    return {
        "id": (Path(folder) / name).as_posix() if folder else name,
        "name": name,
        "kind": item["kind"],
        "path": rel_entry,
        "dir": Path(rel_entry).parent.as_posix(),
        "folder": folder,
        "folderLabel": folders.get(folder, {}).get("label", folder),
        "title": text_field(meta, "title") or extract_title(head) or name,
        "description": text_field(meta, "description") or extract_description(head),
        "date": date,
        "venue": text_field(meta, "venue") or None,
        "authors": text_field(meta, "authors") or None,
        "tags": tags_field(meta),
        "order": meta["order"] if is_number(meta.get("order")) else None,
        "slides": count_slides_heuristic(read_text(entry)),
        "size": size,
        "pptx": pptx.relative_to(root).as_posix() if pptx else None,
        "hash": digest,
        "thumb": None,
        "created": created,
        "updated": updated,
    }


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass


def serve_decks(base: Path):
    """덱 폴더만 127.0.0.1 에 잠깐 띄운다 — file:// 로 열면 덱의 스크립트가 이 PC·러너의 다른 파일을 읽어
    그림에 찍을 수 있고, 덱이 같은 폴더의 자료를 fetch 하는 것도 실제 사이트와 같게 동작한다."""
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_QuietHandler, directory=str(base)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


def render_previews(root: Path, decks: list[dict], cache: Path, want_thumbs: bool) -> None:
    """Playwright 로 장 수를 다시 세고 첫 장 그림을 찍는다. 결과는 내용 지문으로 캐시한다."""
    cache.mkdir(parents=True, exist_ok=True)
    todo = []
    for d in decks:
        key = d["hash"][:16]
        info_p, img_p = cache / f"{key}.json", cache / f"{key}.webp"
        if info_p.is_file() and (img_p.is_file() or not want_thumbs):
            apply_probe(d, load_json(info_p), img_p)
        else:
            todo.append(d)
    if not todo or not want_thumbs:     # 그림을 찍지 않으면 브라우저도 띄우지 않는다(장 수는 HTML 에서 센 값)
        return
    try:
        from playwright.sync_api import sync_playwright
        from PIL import Image
    except ImportError:
        log("  [안내] playwright·pillow 가 없어 미리보기 그림을 건너뜁니다(pip install playwright pillow)")
        return
    httpd, base_url = serve_decks(root / DECKS_DIR)
    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch()
            except Exception as e:  # noqa: BLE001 — 브라우저가 없어도 사이트는 만든다
                log(f"  [안내] 브라우저를 띄우지 못해 미리보기 그림을 건너뜁니다: {e}")
                return
            ctx = browser.new_context(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
            for d in todo:
                key = d["hash"][:16]
                info_p, img_p = cache / f"{key}.json", cache / f"{key}.webp"
                page = ctx.new_page()
                try:
                    rel = d["path"][len(DECKS_DIR) + 1:]
                    page.goto(base_url + quote(rel, safe="/"), wait_until="load", timeout=60000)
                    page.wait_for_timeout(1500)
                    page.evaluate(FONTS_JS)
                    info = page.evaluate(PROBE_JS)
                    shot = None
                    for sel in THUMB_SELECTORS:
                        handle = page.query_selector(sel)
                        box = handle.bounding_box() if handle else None
                        if box and box["width"] >= 200 and box["height"] >= 100:
                            shot = handle.screenshot()
                            break
                    if shot is None:
                        shot = page.screenshot()
                    img = Image.open(io.BytesIO(shot)).convert("RGB")
                    img.thumbnail(THUMB_BOX)
                    img.save(img_p, "WEBP", quality=80, method=6)
                    info_p.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
                    apply_probe(d, info, img_p)
                    log(f"  그림 {d['id']}: {info.get('slides') or '?'}장")
                except Exception as e:  # noqa: BLE001 — 한 덱이 깨져도 나머지는 계속
                    log(f"  [경고] {d['id']} 미리보기 실패: {e}")
                finally:
                    page.close()
            browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()


def prune_cache(cache: Path, decks: list[dict]) -> None:
    """지금 덱에 쓰이지 않는 옛 판의 미리보기 캐시를 지운다(고칠 때마다 쌓이지 않게)."""
    if not cache.is_dir():
        return
    keep = {d["hash"][:16] for d in decks}
    for p in cache.iterdir():
        if CACHE_NAME_RE.match(p.name) and p.name[:16] not in keep:
            p.unlink(missing_ok=True)


def apply_probe(d: dict, info: dict, img_p: Path) -> None:
    if isinstance(info.get("slides"), int) and not isinstance(info.get("slides"), bool) and info["slides"] > 0:
        d["slides"] = info["slides"]
    if d["title"] == d["name"] and isinstance(info.get("title"), str) and info["title"].strip():
        d["title"] = clean_text(info["title"])
    if img_p.is_file():
        d["thumb"] = f"thumbs/{img_p.name}"


def repo_info(root: Path, site: dict) -> tuple[str | None, str]:
    repo = site.get("repo") if isinstance(site.get("repo"), str) else None
    repo = repo or os.environ.get("GITHUB_REPOSITORY")
    branch = site.get("branch") if isinstance(site.get("branch"), str) else None
    branch = branch or os.environ.get("GITHUB_REF_NAME") or "main"
    if not repo:
        r = subprocess.run(["git", "-C", str(root), "remote", "get-url", "origin"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", r.stdout.strip())
        repo = m.group(1) if m else None
    return (repo if repo and REPO_RE.match(repo) else None), branch


def build_manifest(root: Path, thumbs: bool, cache: Path | None, use_git: bool) -> dict:
    base = root / DECKS_DIR
    folders = load_folders(base)
    decks, hidden_files, hidden_dirs = [], [], []
    for it in discover(root):
        try:
            d = describe(root, it, folders, use_git)
        except Exception as e:  # noqa: BLE001 — 한 덱이 깨져도 나머지로 사이트를 만든다
            log(f"  [경고] {it['abs'].relative_to(root).as_posix()} 를 읽지 못해 건너뜁니다: {e}")
            continue
        if d.get("_hidden"):
            if d["kind"] == "dir":
                hidden_dirs.append(d["dir"])
            else:
                hidden_files.extend(d["files"])
            continue
        decks.append(d)
    if cache is not None:
        render_previews(root, decks, cache, thumbs)
        prune_cache(cache, decks)
    decks.sort(key=lambda d: (d["updated"] or "", d["title"]), reverse=True)
    site = load_json(root / "site.json")
    repo, branch = repo_info(root, site)
    folder_list = []
    for key in sorted({d["folder"] for d in decks if d["folder"]}):
        meta = folders.get(key, {})
        folder_list.append({"key": key, "label": meta.get("label", key),
                            "order": meta.get("order"),
                            "count": sum(1 for d in decks if d["folder"] == key)})
    folder_list.sort(key=lambda f: (f["order"] is None, f["order"] or 0, f["label"]))
    return {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "site": {"title": text_field(site, "title") or "HTML 발표자료",
                 "subtitle": text_field(site, "subtitle"),
                 "repo": repo, "branch": branch},
        "folders": folder_list,
        "count": len(decks),
        "decks": decks,
        "_hidden_files": hidden_files,
        "_hidden_dirs": hidden_dirs,
    }


def add_noindex(data: bytes) -> bytes:
    """사이트에 실을 덱 사본에만 검색 제외 표시를 넣는다(저장소의 원본은 그대로).
    덱에 이미 robots 표시가 있어도 넣는다 — 검색 엔진은 여럿 가운데 가장 엄한 것을 따른다.
    <head> 가 없으면 <html> 뒤, 그것도 없으면 <!doctype> 뒤에 넣어 문서 모드가 바뀌지 않게 한다."""
    text = data.decode("utf-8", errors="surrogateescape")
    head = text[:HEAD_BYTES]
    pos = 1 if text.startswith(BOM) else 0
    for rx in (HEAD_OPEN_RE, HTML_OPEN_RE, DOCTYPE_RE):
        m = rx.search(head)
        if m:
            pos = m.end()
            break
    text = text[:pos] + ROBOTS_META + text[pos:]
    return text.encode("utf-8", errors="surrogateescape")


def safe_out_dir(root: Path, out: Path) -> Path:
    out = out.resolve()
    root = root.resolve()
    if out == root or root in out.parents and out.parts[len(root.parts)] in (DECKS_DIR, "tools", "assets", ".git"):
        raise SystemExit(f"출력 폴더로 쓸 수 없는 곳입니다: {out}")
    if out in root.parents:
        raise SystemExit(f"저장소의 상위 폴더는 출력 폴더로 쓸 수 없습니다: {out}")
    if out.exists() and any(out.iterdir()) and not (out / SITE_MARKER).exists():
        raise SystemExit(f"비어 있지 않은 폴더라 덮어쓰지 않습니다(이전 빌드 표시 없음): {out}")
    return out


def build_site(root: Path, out: Path, manifest: dict, cache: Path | None) -> None:
    out = safe_out_dir(root, out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / SITE_MARKER).write_text("html-slides build output\n", encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    for name in SITE_FILES:
        if (root / name).is_file() and not (root / name).is_symlink():
            shutil.copy2(root / name, out / name)
    for name in SITE_DIRS:
        if (root / name).is_dir():
            for src in walk_files(root / name):
                dst = out / src.relative_to(root)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
    hidden_files = set(manifest.get("_hidden_files", []))
    hidden_dirs = tuple(d + "/" for d in manifest.get("_hidden_dirs", []))
    base = root / DECKS_DIR
    for cur, dirs, files in os.walk(base):
        cur_p = Path(cur)
        dirs[:] = sorted(d for d in dirs if not d.startswith((".", "_")) and not (cur_p / d).is_symlink())
        for name in sorted(files):
            src = cur_p / name
            rel = src.relative_to(root).as_posix()
            if (name.startswith((".", "_")) or src.is_symlink() or name.endswith(META_SUFFIX)
                    or rel == f"{DECKS_DIR}/{FOLDERS_FILE}" or rel in hidden_files or rel.startswith(hidden_dirs)
                    or (name == "meta.json" and (cur_p / "index.html").is_file())):
                continue
            if name.lower().endswith(HTML_SUFFIXES + (".pptx",)):
                # 폴더 덱 안에 묻혀 목록에는 없는 덱도 제 정보 파일의 숨김(또는 깨진 정보 파일)을 지킨다
                side = cur_p / (Path(name).stem + META_SUFFIX)
                if side.is_file() and is_hidden(read_meta(side, quiet=True)):
                    continue
            dst = out / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.suffix.lower() in HTML_SUFFIXES:
                dst.write_bytes(add_noindex(src.read_bytes()))
            else:
                shutil.copy2(src, dst)
    if cache is not None:
        thumbs = out / "thumbs"
        thumbs.mkdir(exist_ok=True)
        for d in manifest["decks"]:
            if d.get("thumb"):
                shutil.copy2(cache / Path(d["thumb"]).name, thumbs / Path(d["thumb"]).name)
    public = {k: v for k, v in manifest.items() if not k.startswith("_")}
    public["decks"] = [{k: v for k, v in d.items() if k != "hash"} for d in manifest["decks"]]
    (out / "decks.json").write_text(json.dumps(public, ensure_ascii=False, indent=1, allow_nan=False),
                                    encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    os.environ["NoDefaultCurrentDirectoryInExePath"] = "1"    # Windows: 현재 폴더의 git 을 먼저 쓰지 않게
    ap = argparse.ArgumentParser(description="html-slides 사이트 빌더")
    ap.add_argument("--root", type=Path, default=ROOT, help="저장소 폴더(기본: 이 스크립트의 상위)")
    ap.add_argument("--out", type=Path, help="사이트를 꾸릴 폴더(없으면 목록만 출력)")
    ap.add_argument("--thumbs", action="store_true", help="Playwright 로 첫 장 그림을 찍는다")
    ap.add_argument("--cache", type=Path, help="미리보기 캐시 폴더(장 수·그림)")
    ap.add_argument("--no-git", action="store_true", help="git 기록에서 날짜를 읽지 않는다")
    args = ap.parse_args(argv)
    root = args.root.resolve()
    cache = args.cache.resolve() if args.cache else (root / ".thumbcache" if args.thumbs else None)
    manifest = build_manifest(root, args.thumbs, cache, not args.no_git)
    log(f"덱 {manifest['count']}개 · 폴더 {len(manifest['folders'])}개")
    if args.out:
        build_site(root, args.out, manifest, cache)
        log(f"사이트: {args.out.resolve()}")
    else:
        print(json.dumps({k: v for k, v in manifest.items() if not k.startswith("_")},
                         ensure_ascii=False, indent=1, allow_nan=False))
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
