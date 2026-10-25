import { EditorView, WidgetType } from '@codemirror/view';

/** Clicking a rendered block puts the cursor at its source, which reveals the markdown for editing. */
function revealOnMouseDown(dom: HTMLElement, view: EditorView) {
  dom.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    view.dispatch({
      selection: { anchor: view.posAtDOM(dom) },
      scrollIntoView: true,
    });
    view.focus();
  });
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-md-checkbox';
    box.setAttribute('aria-label', this.checked ? 'Done' : 'To do');
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const from = view.posAtDOM(box);
      const marker = view.state.sliceDoc(from, from + 3);
      if (!/^\[[ xX]\]$/.test(marker)) return;
      view.dispatch({
        changes: {
          from: from + 1,
          to: from + 2,
          insert: marker[1] === ' ' ? 'x' : ' ',
        },
        userEvent: 'input',
      });
    });
    // The toggle happens on mousedown; keep the click from flipping the DOM state on its own.
    box.addEventListener('click', (e) => e.preventDefault());
    return box;
  }
}

export class HrWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-hr';
    wrap.appendChild(document.createElement('hr'));
    revealOnMouseDown(wrap, view);
    return wrap;
  }
}

type Align = 'left' | 'center' | 'right' | null;

/** Splits a GFM table row into trimmed cells, honouring `\|` escapes. */
function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (row[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += row[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignment(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

export class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: TableWidget) {
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    const lines = this.source.split('\n').filter((l) => l.trim() !== '');
    const header = splitRow(lines[0] ?? '');
    const aligns = splitRow(lines[1] ?? '').map(alignment);
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table';
    const table = document.createElement('table');
    const addRow = (parent: HTMLElement, cells: string[], tag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      header.forEach((_, i) => {
        const el = document.createElement(tag);
        el.textContent = cells[i] ?? '';
        const align = aligns[i];
        if (align) el.style.textAlign = align;
        tr.appendChild(el);
      });
      parent.appendChild(tr);
    };
    const thead = document.createElement('thead');
    addRow(thead, header, 'th');
    const tbody = document.createElement('tbody');
    for (const line of lines.slice(2)) addRow(tbody, splitRow(line), 'td');
    table.append(thead, tbody);
    wrap.appendChild(table);
    revealOnMouseDown(wrap, view);
    return wrap;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly block: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.block === this.block
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement(this.block ? 'div' : 'span');
    wrap.className = 'cm-md-image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.addEventListener('load', () => view.requestMeasure());
    img.addEventListener('error', () => {
      const missing = document.createElement('span');
      missing.className = 'cm-md-image-missing';
      missing.textContent = 'Image missing';
      img.replaceWith(missing);
      view.requestMeasure();
    });
    wrap.appendChild(img);
    revealOnMouseDown(wrap, view);
    return wrap;
  }
}
