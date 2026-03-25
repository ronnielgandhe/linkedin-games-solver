void (async () => {
  const SIZE = 6;
  const BOX_ROWS = 2;
  const BOX_COLS = 3;
  const DELAY = 30;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  async function waitForBoard() {
    for (let i = 0; i < 50; i++) {
      let cells = document.querySelectorAll('.sudoku-cell[data-cell-idx]');
      if (cells.length === 0) cells = document.querySelectorAll('[data-cell-idx]');
      if (cells.length === SIZE * SIZE) return true;
      // No sudoku cells after 500ms = not a game frame, bail out
      if (i >= 5 && cells.length === 0 && !document.querySelector('.sudoku-cell')) return false;
      for (const btn of document.querySelectorAll('button')) {
        const text = btn.textContent.trim().toLowerCase();
        if (['play', 'start', 'play now', 'play again', 'continue', 'got it', 'ok', 'let\'s go'].includes(text)) click(btn);
        if (btn.getAttribute('aria-label') === 'Close' || btn.getAttribute('aria-label') === 'Dismiss') click(btn);
      }
      for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
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
        window.__linkedinSolverResult = { error: 'Could not find Sudoku board' };
      }
      return;
    }

    // Find cells: prefer .sudoku-cell, fallback to [data-cell-idx]
    let cells = document.querySelectorAll('.sudoku-cell[data-cell-idx]');
    if (cells.length === 0) cells = document.querySelectorAll('[data-cell-idx]');

    const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    const prefilled = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));

    cells.forEach(el => {
      const idx = parseInt(el.dataset.cellIdx);
      const row = Math.floor(idx / SIZE);
      const col = idx % SIZE;
      // Try .sudoku-cell-content first, then data-cell-content, then textContent
      let val = 0;
      const content = el.querySelector('.sudoku-cell-content') || el.querySelector('[data-cell-content]');
      if (content) {
        val = parseInt(content.textContent.trim()) || 0;
      } else {
        val = parseInt(el.textContent.trim()) || 0;
      }
      if (val >= 1 && val <= SIZE) {
        grid[row][col] = val;
        prefilled[row][col] = true;
      }
    });

    // Check if already solved
    const emptyCount = grid.flat().filter(v => v === 0).length;
    if (emptyCount === 0) {
      window.__linkedinSolverResult = { success: true, message: 'Sudoku is already solved!' };
      return;
    }

    function isValid(g, r, c, n) {
      for (let i = 0; i < SIZE; i++) {
        if (g[r][i] === n || g[i][c] === n) return false;
      }
      const br = Math.floor(r / BOX_ROWS) * BOX_ROWS;
      const bc = Math.floor(c / BOX_COLS) * BOX_COLS;
      for (let ri = br; ri < br + BOX_ROWS; ri++)
        for (let ci = bc; ci < bc + BOX_COLS; ci++)
          if (g[ri][ci] === n) return false;
      return true;
    }

    function solve(g) {
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
          if (g[r][c] === 0) {
            for (let n = 1; n <= SIZE; n++)
              if (isValid(g, r, c, n)) {
                g[r][c] = n;
                if (solve(g)) return true;
                g[r][c] = 0;
              }
            return false;
          }
      return true;
    }

    const solution = grid.map(r => [...r]);
    if (!solve(solution)) {
      window.__linkedinSolverResult = { error: 'No solution found for this Sudoku' };
      return;
    }

    // Find number input buttons: prefer .sudoku-input-button, fallback to buttons by text
    function getNumBtn(n) {
      const byClass = document.querySelector(`.sudoku-input-button:nth-child(${n})`);
      if (byClass) {
        for (const btn of document.querySelectorAll('.sudoku-input-button')) {
          if (btn.textContent.trim() === String(n)) return btn;
        }
      }
      // Fallback: find any button with exact number text
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent.trim() === String(n)) return btn;
      }
      return null;
    }

    let filled = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!prefilled[r][c]) {
          const idx = r * SIZE + c;
          const cell = cells[idx];
          const numBtn = getNumBtn(solution[r][c]);
          if (cell && numBtn) {
            click(cell);
            await sleep(DELAY);
            click(numBtn);
            await sleep(DELAY);
            filled++;
          }
        }
      }
    }

    window.__linkedinSolverResult = { success: true, message: `Sudoku solved! Filled ${filled} cells.` };
  } catch (err) {
    window.__linkedinSolverResult = { error: 'Sudoku error: ' + err.message };
  }
})();
