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
      if (cells.length >= 16) {
        const hasContent = [...cells].some(c =>
          c.querySelector('[data-testid="filled-cell"]') ||
          c.querySelector('[data-cell-content]') ||
          c.children.length >= 1 ||
          (c.textContent.trim() && /^\d+$/.test(c.textContent.trim()))
        );
        if (hasContent) return true;
      }
      if (i >= 5 && cells.length === 0) return false;
      for (const btn of document.querySelectorAll('button')) {
        const t = btn.textContent.trim().toLowerCase();
        if (['play', 'start', 'play now', 'play again', 'continue', 'got it', 'ok', 'let\'s go'].includes(t)) click(btn);
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
        window.__linkedinSolverResult = { error: 'Could not find Zip board' };
      }
      return;
    }

    const t0 = performance.now();
    const cellEls = [...document.querySelectorAll('[data-cell-idx]')]
      .sort((a, b) => parseInt(a.dataset.cellIdx) - parseInt(b.dataset.cellIdx));
    const SIZE = Math.round(Math.sqrt(cellEls.length));
    const TOTAL = SIZE * SIZE;

    // Build cell lookup: idx -> { row, col, element }
    const cellMap = {};
    cellEls.forEach(cell => {
      const idx = parseInt(cell.dataset.cellIdx);
      cellMap[idx] = { row: Math.floor(idx / SIZE), col: idx % SIZE, el: cell };
    });

    // --- 1. Wall detection & waypoints ---
    const conn = {};
    function resetConn() {
      for (let i = 0; i < TOTAL; i++) conn[`${Math.floor(i / SIZE)},${i % SIZE}`] = new Set();
    }
    function avgDeg() {
      return Object.values(conn).reduce((s, c) => s + c.size, 0) / Object.keys(conn).length;
    }

    // Build full grid connectivity (no walls), then remove walls
    function buildFullGrid() {
      resetConn();
      for (let i = 0; i < TOTAL; i++) {
        const row = Math.floor(i / SIZE), col = i % SIZE;
        const key = `${row},${col}`;
        if (row > 0) conn[key].add(`${row - 1},${col}`);
        if (row < SIZE - 1) conn[key].add(`${row + 1},${col}`);
        if (col > 0) conn[key].add(`${row},${col - 1}`);
        if (col < SIZE - 1) conn[key].add(`${row},${col + 1}`);
      }
    }

    // MODE 0 — React Fiber: read walls & waypoints from game state (most reliable)
    let fiberWaypoints = null;
    function tryReactFiber() {
      const fiberKey = Object.keys(cellEls[0]).find(k => k.startsWith('__reactFiber'));
      if (!fiberKey) return false;

      // Find walls array and waypoints from fiber
      let wallsArr = null;
      for (const cell of cellEls) {
        let current = cell[fiberKey];
        for (let i = 0; i < 15 && current; i++) {
          const props = current.memoizedProps;
          if (props && Array.isArray(props.walls)) {
            wallsArr = props.walls;
            break;
          }
          current = current.return;
        }
        if (wallsArr !== null) break;
      }
      // Extract waypoints from sequenceNo
      fiberWaypoints = {};
      for (const cell of cellEls) {
        let current = cell[fiberKey];
        for (let i = 0; i < 15 && current; i++) {
          const props = current.memoizedProps;
          if (props && props.sequenceNo !== undefined && props.idx !== undefined) {
            if (props.sequenceNo >= 0) {
              fiberWaypoints[props.sequenceNo + 1] = props.idx;
            }
            break;
          }
          current = current.return;
        }
      }

      // Build full grid, then remove walls
      buildFullGrid();

      if (wallsArr) {
        for (const wall of wallsArr) {
          const idx = wall.cellIdx;
          const row = Math.floor(idx / SIZE), col = idx % SIZE;
          const key = `${row},${col}`;
          if (wall.direction === 'WallDirection_DOWN' || wall.direction === 'DOWN') {
            const nkey = `${row + 1},${col}`;
            if (conn[key]) conn[key].delete(nkey);
            if (conn[nkey]) conn[nkey].delete(key);
          } else if (wall.direction === 'WallDirection_RIGHT' || wall.direction === 'RIGHT') {
            const nkey = `${row},${col + 1}`;
            if (conn[key]) conn[key].delete(nkey);
            if (conn[nkey]) conn[nkey].delete(key);
          }
        }
      }

      // Accept if we found waypoints (no-walls grids have high avg degree, that's fine)
      return Object.keys(fiberWaypoints).length >= 2;
    }

    // MODE A — Connector elements: non-square children at cell edges
    function tryConnectors() {
      resetConn();
      cellEls.forEach(cell => {
        const idx = parseInt(cell.dataset.cellIdx);
        const row = Math.floor(idx / SIZE), col = idx % SIZE;
        const key = `${row},${col}`;
        [...cell.children].forEach(k => {
          const s = getComputedStyle(k);
          const w = parseFloat(s.width), h = parseFloat(s.height);
          const x = parseFloat(s.left), y = parseFloat(s.top);
          if (isNaN(w) || isNaN(h) || w < 5 || h < 5) return;
          if (Math.abs(w - h) < Math.min(w, h) * 0.1) return;
          if (w < h && x > 20) conn[key].add(`${row},${col + 1}`);
          if (w < h && x < 5)  conn[key].add(`${row},${col - 1}`);
          if (h < w && y > 20) conn[key].add(`${row + 1},${col}`);
          if (h < w && y < 5)  conn[key].add(`${row - 1},${col}`);
        });
      });
      return avgDeg() > 0 && avgDeg() <= 3.0;
    }

    // MODE B — CSS borders: thick border = wall, thin = connection
    function tryBorders() {
      resetConn();
      const allBorders = [];
      cellEls.forEach(cell => {
        const target = cell.children[0] || cell;
        const s = getComputedStyle(target);
        [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth]
          .forEach(b => allBorders.push(parseFloat(b) || 0));
      });
      const uniqueBorders = [...new Set(allBorders.map(b => Math.round(b * 10) / 10))].sort((a, b) => a - b);
      if (uniqueBorders.length < 2 || uniqueBorders[uniqueBorders.length - 1] - uniqueBorders[0] < 1) return false;
      const threshold = (uniqueBorders[0] + uniqueBorders[uniqueBorders.length - 1]) / 2;

      cellEls.forEach(cell => {
        const idx = parseInt(cell.dataset.cellIdx);
        const row = Math.floor(idx / SIZE), col = idx % SIZE;
        const key = `${row},${col}`;
        const target = cell.children[0] || cell;
        const s = getComputedStyle(target);
        const bt = parseFloat(s.borderTopWidth) || 0;
        const br = parseFloat(s.borderRightWidth) || 0;
        const bb = parseFloat(s.borderBottomWidth) || 0;
        const bl = parseFloat(s.borderLeftWidth) || 0;
        if (row > 0 && bt < threshold)       conn[key].add(`${row - 1},${col}`);
        if (col < SIZE - 1 && br < threshold) conn[key].add(`${row},${col + 1}`);
        if (row < SIZE - 1 && bb < threshold) conn[key].add(`${row + 1},${col}`);
        if (col > 0 && bl < threshold)        conn[key].add(`${row},${col - 1}`);
      });
      return avgDeg() > 0 && avgDeg() <= 3.0;
    }

    // Try React fiber first (works everywhere), then DOM fallbacks
    let mode = 'none';
    const attempts = [
      { name: 'fiber', fn: tryReactFiber },
      { name: 'connector', fn: tryConnectors },
      { name: 'border', fn: tryBorders },
    ];

    for (const { name, fn } of attempts) {
      if (fn()) { mode = name; break; }
    }

    if (mode === 'none') {
      const degs = attempts.map(a => { a.fn(); return `${a.name}:${avgDeg().toFixed(1)}`; }).join(' ');
      window.__linkedinSolverResult = { error: `Zip: all wall detection failed (${degs} kids:${cellEls[0]?.children.length})` };
      return;
    }

    // --- 2. Waypoints ---
    // Use fiber waypoints if available, otherwise parse from DOM
    const numberPos = {};
    let maxNum = 0;

    if (fiberWaypoints && Object.keys(fiberWaypoints).length >= 2) {
      for (const [seqStr, cellIdx] of Object.entries(fiberWaypoints)) {
        const n = parseInt(seqStr);
        const row = Math.floor(cellIdx / SIZE), col = cellIdx % SIZE;
        numberPos[n] = { row, col };
        maxNum = Math.max(maxNum, n);
      }
    } else {
      // DOM fallback: parse numbers from cell text
      cellEls.forEach(cell => {
        const idx = parseInt(cell.dataset.cellIdx);
        const row = Math.floor(idx / SIZE), col = idx % SIZE;
        const numEl = cell.querySelector('[data-cell-content]');
        if (numEl) {
          const n = parseInt(numEl.textContent.trim());
          if (!isNaN(n)) { numberPos[n] = { row, col }; maxNum = Math.max(maxNum, n); return; }
        }
        const text = cell.textContent.trim();
        if (text && /^\d+$/.test(text)) {
          const n = parseInt(text);
          numberPos[n] = { row, col };
          maxNum = Math.max(maxNum, n);
        }
      });
    }

    // --- 3. Symmetric connections (for DOM modes; fiber is already symmetric) ---
    let finalConn;
    if (mode === 'fiber') {
      finalConn = conn; // Fiber builds symmetric graph directly
    } else {
      finalConn = {};
      for (const key in conn) finalConn[key] = new Set();
      for (const key in conn) {
        for (const nkey of conn[key]) {
          if (conn[nkey]?.has(key)) {
            finalConn[key].add(nkey);
            finalConn[nkey].add(key);
          }
        }
      }
    }

    // --- 4. Find active cells via flood-fill from waypoint 1 ---
    const active = new Set();
    if (numberPos[1]) {
      const startKey = `${numberPos[1].row},${numberPos[1].col}`;
      const queue = [startKey];
      active.add(startKey);
      while (queue.length > 0) {
        const cur = queue.shift();
        for (const nkey of (finalConn[cur] || [])) {
          if (!active.has(nkey)) {
            active.add(nkey);
            queue.push(nkey);
          }
        }
      }
    }

    const totalActive = active.size;

    // --- 5. Waypoint list ---
    const waypoints = [];
    for (let n = 1; n <= maxNum; n++) {
      if (numberPos[n]) waypoints.push(numberPos[n]);
    }

    if (waypoints.length < 2) {
      const wpList = Object.entries(numberPos).map(([n, p]) => `${n}@(${p.row},${p.col})`).join(' ');
      window.__linkedinSolverResult = { error: `Zip: only ${waypoints.length} wp [${wpList}] ${totalActive} active ${mode}` };
      return;
    }

    // --- 6. Solve Hamiltonian path ---
    function getNeighbors(row, col) {
      const key = `${row},${col}`;
      const result = [];
      for (const nkey of (finalConn[key] || [])) {
        if (active.has(nkey)) {
          const [nr, nc] = nkey.split(',').map(Number);
          result.push({ row: nr, col: nc });
        }
      }
      return result;
    }

    function solve() {
      const path = [waypoints[0]];
      const visited = new Set([`${waypoints[0].row},${waypoints[0].col}`]);
      let nextWp = 1;
      function bt() {
        if (path.length === totalActive) return nextWp >= waypoints.length;
        const curr = path[path.length - 1];

        const candidates = [];
        for (const next of getNeighbors(curr.row, curr.col)) {
          const key = `${next.row},${next.col}`;
          if (visited.has(key)) continue;
          const wpIdx = waypoints.findIndex((w, i) => i >= nextWp && w.row === next.row && w.col === next.col);
          if (wpIdx !== -1 && wpIdx !== nextWp) continue;
          let degree = 0;
          for (const nn of getNeighbors(next.row, next.col)) {
            if (!visited.has(`${nn.row},${nn.col}`)) degree++;
          }
          candidates.push({ next, key, wpIdx, degree, isWp: wpIdx === nextWp });
        }
        candidates.sort((a, b) => {
          if (a.isWp !== b.isWp) return a.isWp ? -1 : 1;
          return a.degree - b.degree;
        });

        for (const { next, key, isWp } of candidates) {
          visited.add(key); path.push(next);
          const oldWp = nextWp;
          if (isWp) nextWp++;
          if (bt()) return true;
          nextWp = oldWp; path.pop(); visited.delete(key);
        }
        return false;
      }
      return bt() ? path : null;
    }

    const t1 = performance.now();
    const solution = solve();
    const t2 = performance.now();

    if (!solution) {
      window.__linkedinSolverResult = { error: `No Zip solution (${totalActive} cells, ${waypoints.length} wp, ${mode}, setup:${Math.round(t1-t0)}ms solve:${Math.round(t2-t1)}ms)` };
      return;
    }

    // --- 7. Return cell indices (coordinates resolved after debugger attaches to avoid banner offset) ---
    const cellIndices = solution.map(s => s.row * SIZE + s.col);

    window.__linkedinSolverResult = {
      success: true,
      needsCDP: true,
      cellIndices,
      message: `Zip solved! ${solution.length} cells (${mode}, setup:${Math.round(t1-t0)}ms solve:${Math.round(t2-t1)}ms)`
    };
  } catch (err) {
    window.__linkedinSolverResult = { error: 'Zip: ' + err.message };
  }
})();
