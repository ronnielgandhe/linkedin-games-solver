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
    function findFiberKey(el) {
      // Method 1: Object.keys (enumerable own properties)
      let key = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (key) return key;
      // Method 2: Object.getOwnPropertyNames (all own properties including non-enumerable)
      try { key = Object.getOwnPropertyNames(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')); } catch(_) {}
      if (key) return key;
      // Method 3: for...in loop (walks prototype chain)
      try { for (const k in el) { if (k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')) return k; } } catch(_) {}
      return null;
    }

    function findPropsKey(el) {
      let key = Object.keys(el).find(k => k.startsWith('__reactProps'));
      if (key) return key;
      try { key = Object.getOwnPropertyNames(el).find(k => k.startsWith('__reactProps')); } catch(_) {}
      if (key) return key;
      try { for (const k in el) { if (k.startsWith('__reactProps')) return k; } } catch(_) {}
      return null;
    }

    function tryReactFiber() {
      const fiberKey = findFiberKey(cellEls[0]);

      // Try __reactProps as fallback for wall/waypoint data
      const propsKey = findPropsKey(cellEls[0]);

      if (!fiberKey && !propsKey) return false;

      // Find walls array and waypoints from fiber tree
      let wallsArr = null;
      if (fiberKey) {
        for (const cell of cellEls) {
          let current = cell[fiberKey];
          for (let i = 0; i < 20 && current; i++) {
            const props = current.memoizedProps;
            if (props && Array.isArray(props.walls)) {
              wallsArr = props.walls;
              break;
            }
            current = current.return;
          }
          if (wallsArr !== null) break;
        }
      }

      // Extract waypoints from fiber (sequenceNo) or props
      fiberWaypoints = {};
      for (const cell of cellEls) {
        if (fiberKey) {
          let current = cell[fiberKey];
          for (let i = 0; i < 20 && current; i++) {
            const props = current.memoizedProps;
            if (props && props.sequenceNo !== undefined && props.idx !== undefined) {
              if (props.sequenceNo >= 0) fiberWaypoints[props.sequenceNo + 1] = props.idx;
              break;
            }
            current = current.return;
          }
        }
        // Also try __reactProps directly on the cell
        if (propsKey && Object.keys(fiberWaypoints).length === 0) {
          const p = cell[propsKey];
          if (p && p.sequenceNo !== undefined && p.idx !== undefined && p.sequenceNo >= 0) {
            fiberWaypoints[p.sequenceNo + 1] = p.idx;
          }
        }
      }

      // Build full grid, then remove walls
      buildFullGrid();

      if (wallsArr) {
        for (const wall of wallsArr) {
          const idx = wall.cellIdx;
          const row = Math.floor(idx / SIZE), col = idx % SIZE;
          const key = `${row},${col}`;
          const dir = wall.direction || '';
          if (dir.includes('DOWN')) {
            const nkey = `${row + 1},${col}`;
            if (conn[key]) conn[key].delete(nkey);
            if (conn[nkey]) conn[nkey].delete(key);
          } else if (dir.includes('RIGHT')) {
            const nkey = `${row},${col + 1}`;
            if (conn[key]) conn[key].delete(nkey);
            if (conn[nkey]) conn[nkey].delete(key);
          }
        }
      }

      // Accept if we found waypoints
      return Object.keys(fiberWaypoints).length >= 2;
    }

    // MODE A — Connector elements: non-square children at cell edges indicate connections
    function tryConnectors() {
      resetConn();
      cellEls.forEach(cell => {
        const idx = parseInt(cell.dataset.cellIdx);
        const row = Math.floor(idx / SIZE), col = idx % SIZE;
        const key = `${row},${col}`;
        const cellRect = cell.getBoundingClientRect();
        const cellW = cellRect.width, cellH = cellRect.height;
        [...cell.children].forEach(k => {
          const kRect = k.getBoundingClientRect();
          const w = kRect.width, h = kRect.height;
          if (w < 5 || h < 5) return;
          // Skip square elements (centers, backgrounds)
          if (Math.abs(w - h) < Math.min(w, h) * 0.15) return;
          // Position relative to cell
          const relL = kRect.left - cellRect.left;
          const relT = kRect.top - cellRect.top;
          const relR = cellRect.right - kRect.right;
          const relB = cellRect.bottom - kRect.bottom;
          if (w < h) {
            // Taller than wide = vertical connector (left or right)
            if (relL > cellW * 0.4 && col < SIZE - 1) conn[key].add(`${row},${col + 1}`);
            if (relL < cellW * 0.1 && col > 0) conn[key].add(`${row},${col - 1}`);
          } else {
            // Wider than tall = horizontal connector (up or down)
            if (relT > cellH * 0.4 && row < SIZE - 1) conn[key].add(`${row + 1},${col}`);
            if (relT < cellH * 0.1 && row > 0) conn[key].add(`${row - 1},${col}`);
          }
        });
      });
      return avgDeg() > 0 && avgDeg() <= 3.5;
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

    // MODE C — Position-based wall detection: compare gaps between adjacent cells
    function tryPositionGaps() {
      resetConn();
      const rects = {};
      cellEls.forEach(cell => {
        const idx = parseInt(cell.dataset.cellIdx);
        const rect = cell.getBoundingClientRect();
        rects[idx] = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });

      // Detect walls by measuring gaps/overlaps between adjacent cells
      // Cells with a wall between them have a larger visual gap
      const hGaps = [], vGaps = [];
      for (let i = 0; i < TOTAL; i++) {
        const row = Math.floor(i / SIZE), col = i % SIZE;
        if (col < SIZE - 1) {
          const right = rects[i + 1];
          if (right) hGaps.push(right.left - rects[i].right);
        }
        if (row < SIZE - 1) {
          const below = rects[i + SIZE];
          if (below) vGaps.push(below.top - rects[i].bottom);
        }
      }

      // Find the gap threshold — walls create bigger gaps
      const allGaps = [...hGaps, ...vGaps].sort((a, b) => a - b);
      if (allGaps.length === 0) return false;
      const uniqueGaps = [...new Set(allGaps.map(g => Math.round(g * 2) / 2))].sort((a, b) => a - b);
      if (uniqueGaps.length < 2 || (uniqueGaps[uniqueGaps.length - 1] - uniqueGaps[0]) < 1) {
        // All gaps same — can't distinguish walls from non-walls via position
        return false;
      }
      const gapThreshold = (uniqueGaps[0] + uniqueGaps[uniqueGaps.length - 1]) / 2;

      for (let i = 0; i < TOTAL; i++) {
        const row = Math.floor(i / SIZE), col = i % SIZE;
        const key = `${row},${col}`;
        // Right neighbor
        if (col < SIZE - 1) {
          const gap = rects[i + 1] ? rects[i + 1].left - rects[i].right : 999;
          if (gap < gapThreshold) {
            conn[key].add(`${row},${col + 1}`);
            conn[`${row},${col + 1}`].add(key);
          }
        }
        // Bottom neighbor
        if (row < SIZE - 1) {
          const gap = rects[i + SIZE] ? rects[i + SIZE].top - rects[i].bottom : 999;
          if (gap < gapThreshold) {
            conn[key].add(`${row + 1},${col}`);
            conn[`${row + 1},${col}`].add(key);
          }
        }
      }
      return avgDeg() > 0;
    }

    // MODE D — Wall children: detect dark/thick bar elements between cells
    function tryWallChildren() {
      // Start with full connectivity, then remove walls detected via child elements
      buildFullGrid();
      let wallsFound = 0;

      cellEls.forEach(cell => {
        const idx = parseInt(cell.dataset.cellIdx);
        const row = Math.floor(idx / SIZE), col = idx % SIZE;
        const key = `${row},${col}`;
        const cellRect = cell.getBoundingClientRect();

        [...cell.children].forEach(kid => {
          const s = getComputedStyle(kid);
          const bg = s.backgroundColor;
          const w = parseFloat(s.width), h = parseFloat(s.height);
          const kRect = kid.getBoundingClientRect();

          // Skip invisible, too small, or non-positioned elements
          if (s.display === 'none' || s.visibility === 'hidden') return;
          if (w < 3 && h < 3) return;

          // Wall bars are typically dark colored, narrow, and at cell edges
          const isDark = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
          const isNarrow = (w < 8 || h < 8); // Wall bars are thin in one dimension

          if (!isDark || !isNarrow) return;

          // Determine wall direction by position relative to cell
          const relLeft = kRect.left - cellRect.left;
          const relTop = kRect.top - cellRect.top;
          const relRight = cellRect.right - kRect.right;
          const relBottom = cellRect.bottom - kRect.bottom;

          if (h < w) {
            // Horizontal bar — wall on top or bottom
            if (relTop < 5 && row > 0) {
              // Wall on top edge
              const nkey = `${row - 1},${col}`;
              conn[key].delete(nkey);
              conn[nkey]?.delete(key);
              wallsFound++;
            } else if (relBottom < 5 && row < SIZE - 1) {
              // Wall on bottom edge
              const nkey = `${row + 1},${col}`;
              conn[key].delete(nkey);
              conn[nkey]?.delete(key);
              wallsFound++;
            }
          } else {
            // Vertical bar — wall on left or right
            if (relLeft < 5 && col > 0) {
              const nkey = `${row},${col - 1}`;
              conn[key].delete(nkey);
              conn[nkey]?.delete(key);
              wallsFound++;
            } else if (relRight < 5 && col < SIZE - 1) {
              const nkey = `${row},${col + 1}`;
              conn[key].delete(nkey);
              conn[nkey]?.delete(key);
              wallsFound++;
            }
          }
        });
      });

      // Valid if we found walls AND avg degree is reasonable (not fully connected)
      return wallsFound > 0 && avgDeg() > 0 && avgDeg() < 3.8;
    }

    if (mode === 'none') {
      if (tryPositionGaps()) {
        mode = 'position';
      } else if (tryWallChildren()) {
        mode = 'wallkids';
      }
    }

    if (mode === 'none') {
      // Collect diagnostic info for debugging
      let diagKeys = [];
      try { diagKeys = Object.getOwnPropertyNames(cellEls[0]).filter(k => k.startsWith('__')).slice(0, 5); } catch(_) {}
      const childInfo = cellEls[0] ? [...cellEls[0].children].map(k => {
        const s = getComputedStyle(k);
        return `${Math.round(parseFloat(s.width))}x${Math.round(parseFloat(s.height))}:${s.backgroundColor?.substring(0, 15)}`;
      }).join('|') : '';
      const degs = attempts.map(a => { a.fn(); return `${a.name}:${avgDeg().toFixed(1)}`; }).join(' ');
      window.__linkedinSolverResult = { error: `Zip: detection failed (${degs} kids:${cellEls[0]?.children.length} ${childInfo} keys:${diagKeys.join(',')})` };
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

    // --- 3. Symmetric connections ---
    // fiber, position, and fullgrid modes already build symmetric graphs
    // connector and border modes need symmetry enforcement
    let finalConn;
    if (mode === 'fiber' || mode === 'position' || mode === 'wallkids') {
      finalConn = conn;
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

    function solve(timeLimit) {
      const deadline = performance.now() + timeLimit;
      const path = [waypoints[0]];
      const visited = new Set([`${waypoints[0].row},${waypoints[0].col}`]);
      let nextWp = 1;
      let iterations = 0;
      function bt() {
        if (++iterations % 5000 === 0 && performance.now() > deadline) return false;
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
    const solution = solve(10000); // 10 second timeout
    const t2 = performance.now();

    if (!solution) {
      const timedOut = (t2 - t1) > 9000 ? ' TIMEOUT' : '';
      window.__linkedinSolverResult = { error: `No Zip solution (${totalActive} active, ${waypoints.length} wp, ${mode}, avgDeg:${avgDeg().toFixed(1)}, ${Math.round(t1-t0)}+${Math.round(t2-t1)}ms${timedOut})` };
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
