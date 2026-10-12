/* 막대의 펼침 메뉴(배치 ▾ · 표 ▾) — 단추를 누르면 단추 아래에 열린다. ↑↓·Home·End 로 옮겨 다니고(쓸 수 없는 항목은 건너뛴다),
   Enter·Space 로 고르고, Esc 는 닫고 단추로 돌아가며, Tab 이나 메뉴 밖(편집기·덱 화면)을 누르면 닫는다.
   단추·항목을 마우스로 눌러도 덱 문서의 초점·선택(표 칸의 캐럿 등)은 그대로 둔다 — 메뉴의 일이 그 선택에 하게. 키보드로 열면
   첫 항목에 초점을 준다. 메뉴 판은 화면에 고정(position: fixed)해 막대가 옆으로 밀리는 좁은 화면에서도 잘리지 않는다. */

export class Menu {
  /* button: 여닫는 단추, menu: [role=menu] 판(항목은 button[role=menuitem][data-act]), deck: 덱 문서(밖을 누르면 닫는다),
     onOpen(): 열기 전에 항목을 켜고 끈다, onPick(act): 고른 항목 */
  constructor({ button, menu, deck, onOpen, onPick }) {
    Object.assign(this, { button, menu, deck, onOpen, onPick });
  }

  get isOpen() { return !this.menu.hidden; }

  items() { return Array.from(this.menu.querySelectorAll('[role="menuitem"]')).filter((b) => !b.disabled && !b.hidden); }

  attach() {
    const { button, menu } = this;
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('mousedown', (e) => e.preventDefault());
    // 키보드(Enter·Space)로 누른 click 은 detail 이 0 — 그때만 첫 항목으로 초점을 옮긴다
    button.addEventListener('click', (e) => (this.isOpen ? this.close(false) : this.open(e.detail === 0)));
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    // 쓸 항목이 하나도 없을 때 키보드로 열면 판 자체에 초점을 둔다(↑↓ 가 고른 상자를 옮기지 않게)
    if (!menu.hasAttribute('tabindex')) menu.tabIndex = -1;
    menu.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('[role="menuitem"]') : null;
      if (!b || b.disabled) return;
      // 키보드로 고른 때(초점이 메뉴 안)는 단추로 돌아간다 — 숨긴 항목에 초점이 남으면 다음 키가 갈 곳이 없다
      this.close(this.menu.contains(document.activeElement));
      this.onPick(b.dataset.act);
    });
    menu.addEventListener('keydown', (e) => this.onKey(e));
    const outside = (e) => {
      if (!this.isOpen) return;
      if (e.target instanceof Element && (this.menu.contains(e.target) || this.button.contains(e.target))) return;
      this.close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    this.deck.addEventListener('pointerdown', () => this.close(false), true);
    // 초점이 덱·막대에 있어도 Esc 는 먼저 메뉴를 닫는다(창 단위 붙잡기 — 다른 키 처리보다 앞선다)
    const esc = (e) => {
      if (!this.isOpen || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.close(this.menu.contains(document.activeElement));
    };
    window.addEventListener('keydown', esc, true);
    if (this.deck.defaultView) this.deck.defaultView.addEventListener('keydown', esc, true);
    window.addEventListener('resize', () => this.close(false));
  }

  open(focusFirst) {
    if (this.onOpen) this.onOpen();
    const m = this.menu;
    m.hidden = false;
    const r = this.button.getBoundingClientRect();
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = r.bottom + 4;
    const top = below + h > window.innerHeight - 8 && r.top - 4 - h >= 8 ? r.top - 4 - h : below;
    m.style.left = `${Math.round(left)}px`;
    m.style.top = `${Math.round(top)}px`;
    this.button.setAttribute('aria-expanded', 'true');
    if (focusFirst) (this.items()[0] || m).focus();
  }

  close(focusBack) {
    if (!this.isOpen) return;
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (focusBack) this.button.focus();
  }

  onKey(e) {
    const items = this.items();
    const i = items.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) items[i < 0 ? 0 : (i + step + items.length) % items.length].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) items[e.key === 'Home' ? 0 : items.length - 1].focus();
    } else if (e.key === 'Tab') {
      e.stopPropagation();
      this.close(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      // 항목 단추의 기본 동작(click)이 고른다 — 막대·덱의 키 처리로는 보내지 않는다
      e.stopPropagation();
    }
  }
}
