/* 그림 넣기 — 고른 그림 파일을 덱 안에 data: 주소로 넣는다(덱 파일 하나에 그림이 함께 들어 따로 올릴 것이 없다).
   그림 자리(data-name="picture")나 그림을 고른 채 넣으면 그 자리에 비율을 지켜 맞춰 넣고, 아니면 장 가운데에 넣는다. */

export const PICTURE_WARN = 4 * 1024 * 1024;     // 이보다 크면 덱 파일이 그만큼 커진다고 알린다
export const PICTURE_MAX = 20 * 1024 * 1024;     // 이보다 크면 넣지 않는다(편집기·저장이 느려진다)
const TYPES = /^image\/(png|jpeg|gif|webp|avif|svg\+xml|bmp)$/;

export function checkPicture(file) {
  if (!TYPES.test(file.type)) return '그림 파일(PNG·JPG·GIF·WebP·AVIF·SVG)을 고르세요.';
  if (file.size > PICTURE_MAX) return `그림이 너무 큽니다(${(file.size / 1048576).toFixed(1)} MB) — 20 MB 보다 작게 줄여 넣으세요.`;
  return '';
}

export function readPicture(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('그림 파일을 읽지 못했습니다.'));
    r.readAsDataURL(file);
  });
}

// 그림의 본래 크기 — 편집기 문서에서 잰다(덱 문서는 스크립트가 없어 다루기 번거롭다). 그림으로 읽히지 않으면(이름만
// .png 인 다른 파일·망가진 파일) null.
export function naturalSize(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const fit = (size, w, h) => {
  const s = Math.min(w / size.w, h / size.h);
  return { w: size.w * s, h: size.h * s };
};

// 그림을 slide 에 넣고 그 요소를 돌려준다. target: 바꿔 넣을 그림 자리(없으면 null)
export function placePicture(model, slide, url, size, alt, target) {
  const img = model.doc.createElement('img');
  img.setAttribute('src', url);
  img.setAttribute('alt', alt);
  if (model.family === 'builder') {
    // 이름(data-name)은 달지 않는다 — ‘모든 장에’가 서로 다른 그림을 같은 이름의 상자로 묶지 않게(같은 그림이면 꼴로 묶인다)
    img.className = 'el';
    let box;
    if (target && target.parentElement === slide) {
      // 자리·크기는 상자에 적힌 값(CSS 크기 — 상자 칸·손잡이와 같은 기준)으로, 적혀 있지 않으면 보이는 크기로
      const x = parseFloat(target.style.left) || target.offsetLeft || 0;
      const y = parseFloat(target.style.top) || target.offsetTop || 0;
      const w = parseFloat(target.style.width) || target.offsetWidth || 400;
      const h = parseFloat(target.style.height) || target.offsetHeight || 300;
      const f = fit(size, w, h);
      box = { x: x + (w - f.w) / 2, y: y + (h - f.h) / 2, w: f.w, h: f.h };
      target.replaceWith(img);
    } else {
      const { w: W, h: H } = model.size;
      const f = fit(size, Math.min(size.w, W * 0.6), Math.min(size.h, H * 0.6));
      box = { x: (W - f.w) / 2, y: (H - f.h) / 2, w: f.w, h: f.h };
      slide.append(img);
    }
    img.style.left = `${Math.round(box.x)}px`;
    img.style.top = `${Math.round(box.y)}px`;
    img.style.width = `${Math.round(box.w)}px`;
    img.style.height = `${Math.round(box.h)}px`;
    img.style.objectFit = 'contain';
    return img;
  }
  // 흐름 덱: 크기를 px 로 적는다 — 바꿔 넣는 자리(그림 자리·그림)가 있으면 그 자리의 보이는 크기 안에 비율대로, 없으면
  // 장의 60%×50% 안에(그림이 더 작으면 그대로). 폭은 늘 칸을 넘지 않게(max-width).
  img.style.maxWidth = '100%';
  img.style.objectFit = 'contain';
  const setSize = (f) => {
    img.style.width = `${Math.max(1, Math.round(f.w))}px`;
    img.style.height = `${Math.max(1, Math.round(f.h))}px`;
  };
  if (target && slide.contains(target)) {
    // 자리의 크기는 레이아웃 크기(offsetWidth — 덱이 건 확대·축소와 상관없는 CSS 크기, 테두리 포함)로
    const r = target.getBoundingClientRect();
    const w = target.offsetWidth || r.width;
    const h = target.offsetHeight || r.height;
    if (w > 0 && h > 0) setSize(fit(size, w, h));
    else img.style.height = 'auto';
    target.replaceWith(img);
    return img;
  }
  const { w: W, h: H } = model.size;
  setSize(fit(size, Math.min(size.w, W * 0.6), Math.min(size.h, H * 0.5)));
  img.style.display = 'block';
  img.style.margin = '16px auto 0';
  const foot = slide.querySelector(':scope > footer, :scope > .foot, :scope > .footer');
  if (foot) foot.before(img);
  else slide.append(img);
  return img;
}

// 파일 이름 → 그림 설명(alt) 바탕
export const altOf = (name) => String(name || '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120);
