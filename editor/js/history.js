/* 되돌리기 기록 — 한 칸은 연산 몇 개의 묶음. 연산을 실제로 적용하는 일은 apply(op, 'undo'|'redo') 가 한다.
   연산 꼴
   {t:'edit',  id, a, b}            장 하나의 사본(전·후)
   {t:'notes', id, a, b}            노트 글(전·후)
   {t:'title', id, a, b}            장 이름(전·후, 빌더 덱의 data-title)
   {t:'ins',   id, at, html, notes} 장 더함(되돌리면 지움)
   {t:'del',   id, at, html, notes} 장 지움(되돌리면 되살림)
   {t:'move',  id, from, to}        장 옮김
   {t:'style', i, a, b}             덱 <style> 의 i 번째 글(전·후) — 모든 장에 한꺼번에(덱 색·글꼴 변수)
   {t:'terms', a, b}                색인에 더한 말(#deck-index 의 글, 전·후)
   {t:'layout', a, b}               쪽 레이아웃의 설정·모양 글({json, css} 또는 null, 전·후) */

export class History {
  constructor(apply, limit = 200) {
    this.apply = apply;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.seq = 0;
    this.savedSeq = 0;
    this.floor = 0;           // 넘쳐서 버린 마지막 칸의 번호 — 다 되돌려도 그 칸까지의 고침은 덱에 남아 있다
  }

  push(ops) {
    const list = ops.filter(Boolean);
    if (!list.length) return;
    this.seq += 1;
    this.undoStack.push({ ops: list, seq: this.seq });
    if (this.undoStack.length > this.limit) this.floor = this.undoStack.shift().seq;
    this.redoStack.length = 0;
  }

  undo() {
    const g = this.undoStack.pop();
    if (!g) return null;
    for (const op of g.ops.slice().reverse()) this.apply(op, 'undo');
    this.redoStack.push(g);
    return g;
  }

  redo() {
    const g = this.redoStack.pop();
    if (!g) return null;
    for (const op of g.ops) this.apply(op, 'redo');
    this.undoStack.push(g);
    return g;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  topSeq() { return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].seq : this.floor; }
  get dirty() { return this.topSeq() !== this.savedSeq; }
  markSaved() { this.savedSeq = this.topSeq(); }
}
