/* 임시 저장본 — 저장하지 않은 고침을 이 브라우저(IndexedDB)에만 남긴다. 편집 창(세션)마다 한 줄: 처음 남길 때 줄을 만들고
   그다음부터는 그 줄을 고쳐 쓴다(그 창의 마지막 고침). 그 창에서 저장하면 그 줄만 지우고, 다른 창·다른 때의 줄은 그대로 둔다.
   오래된 줄은 덱마다 새것부터 KEEP 개, MAX_AGE 안의 것만 둔다 — 창이 닫히거나 브라우저가 멈춘 뒤 다른 창에서 고치기
   시작해도 그 줄은 남아 ‘판 기록’에서 불러올 수 있다. 목록(drafts)과 글(draftText)을 따로 두어, 목록을 볼 때 큰 덱의 글까지
   모두 읽지 않는다. 같은 사이트(출처)의 다른 페이지도 읽고 쓸 수 있는 자리라 비밀을 두는 곳은 아니다(덱 자체가 공개
   저장소의 것이다 — README 의 ‘판 기록’). IndexedDB 를 못 쓰는 브라우저(사생활 보호 창 등)에서는 남기지 못했다고 알린다.
   IndexedDB 가 열리지 않고 멈추면(일부 브라우저의 결함) OPEN_WAIT 뒤에 못 쓴다고 보고 넘어간다 — 편집기가 기다리다 멈추지 않게. */

const DB = 'hs-editor';
const META = 'drafts';
const TEXT = 'draftText';
const KEEP = 5;                                  // 덱마다 남기는 줄(편집 창) 수
const MAX_AGE = 30 * 24 * 3600 * 1000;           // 이보다 오래된 줄은 지운다(30일, 어느 덱의 것이든)
const OPEN_WAIT = 6000;                          // 저장소를 여는 데 이보다 오래 걸리면 못 쓴다고 본다

let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      let req;
      let late = false;
      const timer = setTimeout(() => { late = true; reject(new Error('timeout')); }, OPEN_WAIT);
      const fail = (e) => { clearTimeout(timer); reject(e); };
      try {
        req = indexedDB.open(DB, 1);
      } catch (e) {
        fail(e);
        return;
      }
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore(META, { keyPath: 'id', autoIncrement: true }).createIndex('deck', 'deck');
        d.createObjectStore(TEXT);                    // 열쇠 = 목록의 id
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const d = req.result;
        if (late) {                                   // 기다리다 그만둔 뒤에 열렸다 — 닫는다(다음에 다시 연다)
          d.close();
          return;
        }
        const mine = dbp;
        d.onversionchange = () => { d.close(); dbp = null; };   // 다른 탭이 새 판(구조)으로 열면 비켜 준다
        d.onclose = () => { if (dbp === mine) dbp = null; };     // 브라우저가 닫으면(사이트 데이터 지우기 등) 다음에 다시 연다
        resolve(d);
      };
      req.onerror = () => fail(req.error);
      req.onblocked = () => fail(new Error('blocked'));
    }).catch((e) => { dbp = null; throw e; });
  }
  return dbp;
}

// 거래 하나 — fn({meta, text}) 이 돌려준 값을 거래가 끝난 뒤 돌려준다. fn 안에서는 IndexedDB 요청만 기다린다(다른 것을
// 기다리면 거래가 저절로 끝난다).
function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction([META, TEXT], mode);
    let out;
    Promise.resolve(fn({ meta: t.objectStore(META), text: t.objectStore(TEXT) })).then((v) => { out = v; }, (e) => {
      try { t.abort(); } catch (x) { /* 이미 끝남 */ }
      reject(e);
    });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('abort'));
  }));
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const newest = (list) => list.sort((a, b) => b.time - a.time || b.id - a.id);
const rowId = (id) => {
  const key = Number(id);
  return Number.isSafeInteger(key) && key > 0 ? key : 0;
};

// 이 덱의 임시 저장본 목록(글 빼고) — 새것부터
export async function listDrafts(deck) {
  try {
    return newest(await tx('readonly', (s) => req(s.meta.index('deck').getAll(deck))));
  } catch (e) {
    return [];
  }
}

// 임시 저장본 하나 — {…목록, text}, 없으면 null
export async function getDraft(id) {
  const key = rowId(id);
  if (!key) return null;
  try {
    return await tx('readonly', async (s) => {
      const m = await req(s.meta.get(key));
      const text = m ? await req(s.text.get(key)) : null;
      return m && typeof text === 'string' ? { ...m, text } : null;
    });
  } catch (e) {
    return null;
  }
}

/* 남긴다 — id(이 창의 줄)가 있으면 그 줄을 고쳐 쓰고, 없거나 그 사이 지워졌으면 새 줄을 만든다. 남긴 줄의 id 를, 남기지
   못했으면 0 을 돌려준다. 남긴 김에 오래된 줄을 정리한다 — 이 덱은 새것부터 KEEP 개, 어느 덱이든 MAX_AGE 넘은 것은 지운다
   (방금 쓴 줄은 늘 남는다). prune 이 거짓이면 정리하지 않는다(판 기록 창에 보이는 줄을 고르는 동안 지우지 않게).
   meta: 목록에 함께 적을 것({slides, base} 등 — deck·time·size 는 여기서 정한다) */
export async function putDraft(deck, text, meta = {}, id = 0, prune = true) {
  try {
    return await tx('readwrite', async (s) => {
      const time = Date.now();
      const row = { ...meta, deck, time, size: text.length };
      let key = rowId(id);
      if (key) {
        const cur = await req(s.meta.get(key));
        if (!cur || cur.deck !== deck) key = 0;
      }
      if (key) await req(s.meta.put({ ...row, id: key }));
      else key = await req(s.meta.add(row));
      await req(s.text.put(text, key));
      if (!prune) return key;
      let kept = 0;
      for (const d of newest(await req(s.meta.getAll()))) {
        if (d.id === key) continue;
        const fresh = time - d.time < MAX_AGE;
        if (fresh && d.deck !== deck) continue;              // 다른 덱의 것은 오래된 것만 지운다
        if (fresh && kept < KEEP - 1) {
          kept += 1;
          continue;
        }
        await req(s.meta.delete(d.id));
        await req(s.text.delete(d.id));
      }
      return key;
    });
  } catch (e) {
    return 0;
  }
}

// 줄 하나 지우기(그 창에서 저장한 뒤) — 지웠거나 이미 없거나 둘 것이면 true. time 을 주면 그때 남긴 그대로일 때만 지운다
// (다시 연 줄을 그 뒤 다른 창이 고쳐 썼으면 그 창의 고침이니 둔다).
export async function deleteDraft(id, time = 0) {
  const key = rowId(id);
  if (!key) return true;
  try {
    await tx('readwrite', async (s) => {
      if (time) {
        const m = await req(s.meta.get(key));
        if (!m || m.time !== time) return;
      }
      await req(s.meta.delete(key));
      await req(s.text.delete(key));
    });
    return true;
  } catch (e) {
    return false;
  }
}
