// LinkedIn Mini Sudoku Auto-Solver
// Usage: Paste this into the browser console on the LinkedIn Mini Sudoku page
// Or load it as a bookmarklet / Chrome extension content script

(async function solveMiniSudoku() {
  const SIZE = 6;
  const BOX_ROWS = 2;
  const BOX_COLS = 3;
  const DELAY_MS = 150; // delay between clicks for visual effect & reliability

  // --- Step 1: Read the grid from the DOM ---
  function readGrid() {
    const cells = document.querySelectorAll('.sudoku-cell[data-cell-idx]');
    if (cells.length !== SIZE * SIZE) {
      throw new Error(`Expected ${SIZE * SIZE} cells, found ${cells.length}`);
    }

    const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    const prefilled = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));

    cells.forEach(el => {
      const idx = parseInt(el.dataset.cellIdx);
      const row = Math.floor(idx / SIZE);
      const col = idx % SIZE;
      const content = el.querySelector('.sudoku-cell-content');
      const val = content ? parseInt(content.textContent.trim()) : 0;

      if (!isNaN(val) && val >= 1 && val <= SIZE) {
        grid[row][col] = val;
        prefilled[row][col] = true;
      }
    });

    return { grid, prefilled };
  }

  // --- Step 2: Solve using backtracking ---
  function isValid(grid, row, col, num) {
    // Check row
    for (let c = 0; c < SIZE; c++) {
      if (grid[row][c] === num) return false;
    }
    // Check column
    for (let r = 0; r < SIZE; r++) {
      if (grid[r][col] === num) return false;
    }
    // Check box
    const boxRowStart = Math.floor(row / BOX_ROWS) * BOX_ROWS;
    const boxColStart = Math.floor(col / BOX_COLS) * BOX_COLS;
    for (let r = boxRowStart; r < boxRowStart + BOX_ROWS; r++) {
      for (let c = boxColStart; c < boxColStart + BOX_COLS; c++) {
        if (grid[r][c] === num) return false;
      }
    }
    return true;
  }

  function solve(grid) {
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        if (grid[row][col] === 0) {
          for (let num = 1; num <= SIZE; num++) {
            if (isValid(grid, row, col, num)) {
              grid[row][col] = num;
              if (solve(grid)) return true;
              grid[row][col] = 0;
            }
          }
          return false; // no valid number found, backtrack
        }
      }
    }
    return true; // all cells filled
  }

  // --- Step 3: Input the solution by clicking cells + number buttons ---
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function clickElement(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function getNumberButton(num) {
    const buttons = document.querySelectorAll('.sudoku-input-button');
    for (const btn of buttons) {
      if (btn.textContent.trim() === String(num)) return btn;
    }
    return null;
  }

  function getCellElement(row, col) {
    const idx = row * SIZE + col;
    return document.querySelector(`.sudoku-cell[data-cell-idx="${idx}"]`);
  }

  async function inputSolution(grid, prefilled) {
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        if (!prefilled[row][col]) {
          const cell = getCellElement(row, col);
          const numBtn = getNumberButton(grid[row][col]);

          if (!cell || !numBtn) {
            console.error(`Could not find cell (${row},${col}) or button for ${grid[row][col]}`);
            continue;
          }

          // Click the cell to select it
          clickElement(cell);
          await sleep(DELAY_MS);

          // Click the number button to enter the value
          clickElement(numBtn);
          await sleep(DELAY_MS);
        }
      }
    }
  }

  // --- Main ---
  try {
    console.log('🧩 LinkedIn Mini Sudoku Solver starting...');

    // Read current puzzle
    const { grid, prefilled } = readGrid();
    console.log('📖 Current grid:');
    console.log(grid.map(row => row.map(v => v || '_').join(' ')).join('\n'));

    // Solve it
    const gridCopy = grid.map(row => [...row]);
    if (!solve(gridCopy)) {
      console.error('❌ No solution found!');
      return;
    }

    console.log('✅ Solution found:');
    console.log(gridCopy.map(row => row.join(' ')).join('\n'));

    // Input the solution
    console.log('⌨️ Entering solution...');
    await inputSolution(gridCopy, prefilled);

    console.log('🎉 Done! Puzzle should be solved.');
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
