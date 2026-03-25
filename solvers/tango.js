void (async () => {
  const SUN = 0;
  const MOON = 1;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  async function waitForBoard() {
    for (let i = 0; i < 50; i++) {
      // Look for gameboard with enough cells
      const board = document.querySelector('[aria-label="Gameboard"]');
      if (board) {
        const cells = [...board.querySelectorAll('[data-testid^="cell-"]')]
          .filter(el => /^cell-\d+$/.test(el.getAttribute('data-testid')));
        if (cells.length >= 16) return true;
      }
      // No gameboard after 500ms = not a game frame, bail out
      if (i >= 5 && !board) return false;
      for (const btn of document.querySelectorAll('button')) {
        const text = btn.textContent.trim().toLowerCase();
        if (text === 'play' || text === 'start') click(btn);
        if (btn.getAttribute('aria-label') === 'Close') click(btn);
      }
      for (const d of document.querySelectorAll('[role="dialog"]')) {
        const close = d.querySelector('button');
        if (close) click(close);
      }
      await sleep(100);
    }
    return false;
  }

  try {
    if (!(await waitForBoard())) {
      if (document.querySelectorAll('*').length > 100) {
        window.__linkedinSolverResult = { error: 'Could not find Tango board' };
      }
      return;
    }

    const board = document.querySelector('[aria-label="Gameboard"]');
    if (!board) {
      window.__linkedinSolverResult = { error: 'No Gameboard element' };
      return;
    }

    // Get ONLY actual cell elements (cell-0, cell-1, ...) — skip cell-zero, cell-one etc.
    const cellEls = [...board.querySelectorAll('[data-testid^="cell-"]')]
      .filter(el => /^cell-\d+$/.test(el.getAttribute('data-testid')))
      .sort((a, b) => {
        const ai = parseInt(a.getAttribute('data-testid').replace('cell-', ''));
        const bi = parseInt(b.getAttribute('data-testid').replace('cell-', ''));
        return ai - bi;
      });

    const SIZE = Math.round(Math.sqrt(cellEls.length));
    if (SIZE * SIZE !== cellEls.length) {
      window.__linkedinSolverResult = { error: `Tango: grid not square (${cellEls.length} cells)` };
      return;
    }

    // Read grid: -1 = empty, 0 = sun, 1 = moon
    const grid = [];
    const prefilled = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const svg = cellEls[i].querySelector('svg[aria-label]');
      const label = svg ? svg.getAttribute('aria-label') : '';
      if (label === 'Sun') {
        grid.push(SUN);
        prefilled.push(true);
      } else if (label === 'Moon') {
        grid.push(MOON);
        prefilled.push(true);
      } else {
        grid.push(-1);
        prefilled.push(false);
      }
    }

    if (grid.every(v => v !== -1)) {
      window.__linkedinSolverResult = { success: true, message: 'Tango is already solved!' };
      return;
    }

    function idx(r, c) { return r * SIZE + c; }

    // Parse edge constraints — handle both nested and sibling edge elements
    const constraints = [];
    const seen = new Set();
    const edgeEls = board.querySelectorAll('[data-testid="edge-equal"], [data-testid="edge-cross"]');

    for (const e of edgeEls) {
      const type = e.getAttribute('data-testid') === 'edge-equal' ? 'same' : 'diff';
      const cellEl = e.closest('[data-testid^="cell-"]');

      if (cellEl) {
        // Edge is nested inside a cell — use position offset to find neighbor
        const cellIdx = parseInt(cellEl.getAttribute('data-testid').replace('cell-', ''));
        const cellRow = Math.floor(cellIdx / SIZE);
        const cellCol = cellIdx % SIZE;

        const cellRect = cellEl.getBoundingClientRect();
        const edgeRect = e.getBoundingClientRect();
        const dx = (edgeRect.left + edgeRect.width / 2) - (cellRect.left + cellRect.width / 2);
        const dy = (edgeRect.top + edgeRect.height / 2) - (cellRect.top + cellRect.height / 2);

        let r2 = cellRow, c2 = cellCol;
        if (Math.abs(dx) > Math.abs(dy)) {
          c2 += dx > 0 ? 1 : -1;
        } else {
          r2 += dy > 0 ? 1 : -1;
        }

        if (r2 >= 0 && r2 < SIZE && c2 >= 0 && c2 < SIZE) {
          const key = `${Math.min(idx(cellRow, cellCol), idx(r2, c2))}-${Math.max(idx(cellRow, cellCol), idx(r2, c2))}`;
          if (!seen.has(key)) {
            seen.add(key);
            constraints.push({ type, i1: idx(cellRow, cellCol), i2: idx(r2, c2) });
          }
        }
      } else {
        // Edge is a sibling — find two closest cells by position
        const edgeRect = e.getBoundingClientRect();
        const ecx = edgeRect.left + edgeRect.width / 2;
        const ecy = edgeRect.top + edgeRect.height / 2;

        const dists = cellEls.map((c, i) => {
          const r = c.getBoundingClientRect();
          return { i, dist: Math.hypot(r.left + r.width / 2 - ecx, r.top + r.height / 2 - ecy) };
        }).sort((a, b) => a.dist - b.dist);

        const i1 = dists[0].i;
        const i2 = dists[1].i;
        const key = `${Math.min(i1, i2)}-${Math.max(i1, i2)}`;
        if (!seen.has(key)) {
          seen.add(key);
          constraints.push({ type, i1, i2 });
        }
      }
    }

    // Solver
    const half = SIZE / 2;

    function isValidPartial(g) {
      for (let r = 0; r < SIZE; r++) {
        let sunCount = 0, moonCount = 0;
        for (let c = 0; c < SIZE; c++) {
          const v = g[idx(r, c)];
          if (v === SUN) sunCount++;
          if (v === MOON) moonCount++;
        }
        if (sunCount > half || moonCount > half) return false;

        for (let c = 0; c <= SIZE - 3; c++) {
          const a = g[idx(r, c)], b = g[idx(r, c + 1)], cc = g[idx(r, c + 2)];
          if (a !== -1 && a === b && b === cc) return false;
        }
      }

      for (let c = 0; c < SIZE; c++) {
        let sunCount = 0, moonCount = 0;
        for (let r = 0; r < SIZE; r++) {
          const v = g[idx(r, c)];
          if (v === SUN) sunCount++;
          if (v === MOON) moonCount++;
        }
        if (sunCount > half || moonCount > half) return false;

        for (let r = 0; r <= SIZE - 3; r++) {
          const a = g[idx(r, c)], b = g[idx(r + 1, c)], d = g[idx(r + 2, c)];
          if (a !== -1 && a === b && b === d) return false;
        }
      }

      for (const { type, i1, i2 } of constraints) {
        const v1 = g[i1], v2 = g[i2];
        if (v1 === -1 || v2 === -1) continue;
        if (type === 'same' && v1 !== v2) return false;
        if (type === 'diff' && v1 === v2) return false;
      }

      return true;
    }

    function solve(g) {
      const emptyIdx = g.indexOf(-1);
      if (emptyIdx === -1) return true;

      for (const val of [SUN, MOON]) {
        g[emptyIdx] = val;
        if (isValidPartial(g) && solve(g)) return true;
        g[emptyIdx] = -1;
      }
      return false;
    }

    const solution = [...grid];
    if (!solve(solution)) {
      window.__linkedinSolverResult = { error: `No Tango solution (${SIZE}x${SIZE}, ${constraints.length} constraints)` };
      return;
    }

    // Enter solution: click cycle is Empty -> Sun -> Moon -> Empty
    // 1 click = Sun, 2 clicks = Moon
    const toFill = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (!prefilled[i]) toFill.push(i);
    }

    // Set success BEFORE filling so the result is available even if the game
    // triggers a completion overlay/navigation after the last cell is filled.
    window.__linkedinSolverResult = { success: true, message: `Tango solved! Filled ${toFill.length} cells.` };

    for (const i of toFill) {
      const target = solution[i];
      const clicks = target === SUN ? 1 : 2;
      const clickTarget = cellEls[i].querySelector('div') || cellEls[i];
      for (let c = 0; c < clicks; c++) {
        click(clickTarget);
        await sleep(30);
      }
    }
  } catch (err) {
    window.__linkedinSolverResult = { error: 'Tango error: ' + err.message };
  }
})();
