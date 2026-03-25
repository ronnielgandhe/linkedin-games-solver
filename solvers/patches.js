void (async () => {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  async function waitForBoard() {
    for (let i = 0; i < 50; i++) {
      const cells = document.querySelectorAll('[data-cell-idx]');
      const patchesBoard = document.querySelector('[data-testid="patches-game-board"]')
        || document.querySelector('[data-testid="interactive-grid"]');
      if (patchesBoard && cells.length >= 16) return true;
      if (i >= 5 && cells.length === 0 && !patchesBoard) return false;
      for (const btn of document.querySelectorAll('button')) {
        const t = btn.textContent.trim().toLowerCase();
        if (['play', 'start', 'play now', 'play again', 'continue', 'got it', 'ok', "let's go"].includes(t)) click(btn);
        if (btn.getAttribute('aria-label') === 'Close' || btn.getAttribute('aria-label') === 'Dismiss') click(btn);
      }
      for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
        const close = d.querySelector('button[aria-label="Close"], button[aria-label="Dismiss"], button');
        if (close) click(close);
      }
      await sleep(100);
    }
    return false;
  }

  try {
    if (!(await waitForBoard())) {
      if (document.querySelectorAll('*').length > 100) {
        window.__linkedinSolverResult = { error: 'Could not find Patches board' };
      }
      return;
    }

    const t0 = performance.now();
    const cellEls = [...document.querySelectorAll('[data-cell-idx]')]
      .sort((a, b) => parseInt(a.dataset.cellIdx) - parseInt(b.dataset.cellIdx));

    // --- 1. Extract solution from React fiber ---
    const fiberKey = Object.keys(cellEls[0]).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) {
      window.__linkedinSolverResult = { error: 'Patches: no React fiber found' };
      return;
    }

    let solution = null;
    let gridCols = null;
    let current = cellEls[0][fiberKey];
    for (let i = 0; i < 40 && current; i++) {
      const mp = current.memoizedProps;
      if (mp?.game?.puzzle?.patchesGamePuzzle) {
        const pgp = mp.game.puzzle.patchesGamePuzzle;
        solution = pgp.solution;
        gridCols = pgp.gridCols;
        break;
      }
      current = current.return;
    }

    if (!solution || !Array.isArray(solution) || solution.length === 0) {
      window.__linkedinSolverResult = { error: 'Patches: could not read solution from game state' };
      return;
    }

    const COLS = gridCols || Math.round(Math.sqrt(cellEls.length));

    // --- 2. Convert solution regions to drag coordinates ---
    // Each region is rectangular. Drag from top-left cell center to bottom-right cell center.
    const drags = [];
    for (const region of solution) {
      const cellIdxes = region.cellIdxes;
      const rows = cellIdxes.map(i => Math.floor(i / COLS));
      const cols = cellIdxes.map(i => i % COLS);
      const minRow = Math.min(...rows), maxRow = Math.max(...rows);
      const minCol = Math.min(...cols), maxCol = Math.max(...cols);

      const topLeftIdx = minRow * COLS + minCol;
      const botRightIdx = maxRow * COLS + maxCol;

      const r1 = cellEls[topLeftIdx].getBoundingClientRect();
      const r2 = cellEls[botRightIdx].getBoundingClientRect();

      drags.push({
        from: [Math.round(r1.left + r1.width / 2), Math.round(r1.top + r1.height / 2)],
        to: [Math.round(r2.left + r2.width / 2), Math.round(r2.top + r2.height / 2)],
      });
    }

    const t1 = performance.now();

    window.__linkedinSolverResult = {
      success: true,
      needsCDP: true,
      cdpType: 'drag',
      drags,
      message: `Patches solved! ${solution.length} regions (${Math.round(t1 - t0)}ms)`,
    };
  } catch (err) {
    window.__linkedinSolverResult = { error: 'Patches: ' + err.message };
  }
})();
