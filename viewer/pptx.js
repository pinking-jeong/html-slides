/* html-slides PPTX 뷰어 — 공개된 PPTX 를 Microsoft Office 웹 뷰어(view.officeapps.live.com)로 보여 준다.
   주소: pptx.html#file=decks/…/이름.pptx[&v=판][&embed=1(갤러리 미리보기 창)]
   Office 웹 뷰어는 인터넷에 공개된 10 MB 이하 파일만 연다 — 그 밖에는 받기 안내를 보인다. */
import {
  $, params, deckFile, rev, fileUrl, fileName, findDeck, deckTitle, setDownload, showMessage, OFFICE_MAX,
} from './common.js';

const OFFICE = 'https://view.officeapps.live.com/op/embed.aspx?src=';
// Office 뷰어는 안에서 양식을 제출해 화면을 불러오므로 allow-forms 가 있어야 그려진다(2026-10 확인).
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';

const P = params();
const file = deckFile(P.get('file'), '.pptx');
const v = rev(P.get('v'));
const embed = P.get('embed') === '1';
const els = { office: $('office'), msg: $('msg'), title: $('title'), get: $('get'), pdfView: $('pdfView') };

document.body.classList.toggle('embed', embed);

const mb = (n) => `${(n / 1000000).toFixed(1)} MB`;
const download = () => [['PPTX 받기', fileUrl(file, v).href, fileName(file)]];

// Office 웹 뷰어는 Microsoft 서버가 파일을 가져가므로 이 PC 의 미리보기(slides serve)에서는 열 수 없다.
function isLocal() {
  const host = location.hostname.replace(/^\[|\]$/g, '');
  return location.protocol !== 'https:' || host === 'localhost' || host === '::1' || /^127\./.test(host);
}

async function headSize(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    const n = Number(r.headers.get('content-length'));
    return r.ok && Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    return null;
  }
}

function sizeOf(deck) {
  if (!deck) return null;
  if (deck.path === file && typeof deck.size === 'number') return deck.size;
  if (deck.pptx === file && typeof deck.pptxSize === 'number') return deck.pptxSize;
  return null;
}

function applyDeck(deck) {
  const title = deckTitle(deck, file);
  els.title.textContent = title;
  document.title = title;
  const pdf = deck && typeof deck.pdf === 'string' ? deckFile(deck.pdf, '.pdf')
    : deck && deck.kind === 'pdf' ? deckFile(deck.path, '.pdf') : null;
  if (pdf) {
    const pv = rev(deck.pdf ? deck.pdfRev : deck.rev);
    els.pdfView.href = `pdf.html#file=${encodeURIComponent(pdf)}${pv ? `&v=${pv}` : ''}`;
    els.pdfView.hidden = false;
  }
  return title;
}

function mount(title) {
  const f = document.createElement('iframe');
  f.title = `PowerPoint 보기 — ${title}`;
  f.setAttribute('sandbox', SANDBOX);
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('allow', 'fullscreen');
  f.src = OFFICE + encodeURIComponent(fileUrl(file, v).href);
  els.office.prepend(f);
}

async function start() {
  if (!file) {
    showMessage(els.msg, '열 PPTX 가 없습니다', '주소가 잘못되었습니다 — 갤러리에서 다시 열어 주세요.', []);
    return;
  }
  setDownload(els.get, file, v);
  applyDeck(null);
  const deck = await findDeck(file);
  const title = applyDeck(deck);
  const size = sizeOf(deck) ?? await headSize(fileUrl(file, v));
  if (typeof size === 'number' && size > OFFICE_MAX) {
    showMessage(els.msg, '10 MB 가 넘는 PPTX 는 웹에서 재생하지 않습니다',
      `이 파일은 ${mb(size)} 입니다. Office 웹 뷰어는 10 MB 까지만 엽니다 — 받아서 보거나, ` +
      'PowerPoint 에서 PDF 로 내보내 같은 이름으로 함께 올리면 갤러리에서 바로 재생됩니다.',
      download());
    return;
  }
  if (isLocal()) {
    showMessage(els.msg, '이 PC 의 미리 보기에서는 재생하지 않습니다',
      'Office 웹 뷰어(Microsoft)는 인터넷에 공개된 파일만 엽니다. 갤러리에 올린 뒤에는 바로 재생됩니다 — 지금은 받아서 보세요.',
      download());
    return;
  }
  mount(title);
}

start();
