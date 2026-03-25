const VERSION = '1.4';

const GAME_URLS = {
  sudoku: 'https://www.linkedin.com/games/mini-sudoku/',
  tango: 'https://www.linkedin.com/games/tango/',
  queens: 'https://www.linkedin.com/games/queens/',
  zip: 'https://www.linkedin.com/games/zip/',
  patches: 'https://www.linkedin.com/games/patches/',
};

function setStatus(type, text) {
  const el = document.getElementById('status');
  const icon = document.getElementById('status-icon');
  const textEl = document.getElementById('status-text');
  el.className = `status ${type}`;
  textEl.textContent = text;
  icon.textContent = type === 'solving' ? '\u23F3' : type === 'success' ? '\u2705' : '\u274C';
}

function disableButtons(disabled) {
  document.querySelectorAll('.game-card').forEach(btn => btn.disabled = disabled);
}

async function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

// Poll for solver result from ANY frame (game lives in an iframe)
// Prefer success/CDP results over errors — non-game frames may report
// "board not found" before the game iframe finishes solving.
async function pollForResult(tabId, maxAttempts, intervalMs) {
  let lastError = null;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const checks = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        func: () => window.__linkedinSolverResult,
      });
      for (const check of checks) {
        if (check?.result?.success || check?.result?.needsCDP) return check.result;
        if (check?.result?.error) lastError = check.result;
      }
    } catch {
      return null;
    }
  }
  return lastError;
}

async function solveGame(game) {
  disableButtons(true);
  setStatus('solving', `Opening ${game}...`);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const gameSlug = GAME_URLS[game].replace('https://www.linkedin.com', '');
    const isOnPage = tab.url && tab.url.includes(gameSlug);

    if (!isOnPage) {
      await chrome.tabs.update(tab.id, { url: GAME_URLS[game] });
      await waitForTabLoad(tab.id);
      await new Promise(r => setTimeout(r, 500));
    }

    setStatus('solving', `Solving ${game}...`);

    // Clear previous result in ALL frames
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'MAIN',
        func: () => { window.__linkedinSolverResult = null; },
      });
    } catch (e) {
      setStatus('error', 'Clear failed: ' + e.message);
      disableButtons(false);
      return;
    }

    // Inject solver into ALL frames (MAIN world needed for React fiber access)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'MAIN',
        files: [`solvers/${game}.js`],
      });
    } catch (e) {
      setStatus('error', 'Inject failed: ' + e.message);
      disableButtons(false);
      return;
    }

    setStatus('solving', `Waiting for solution...`);

    // Poll for result from any frame — fast interval for quick detection
    const result = await pollForResult(tab.id, 200, 100);

    if (result && result.needsCDP && result.coords) {
      // Zip: needs trusted clicks via chrome.debugger CDP
      setStatus('solving', 'Executing solution...');
      try {
        const cdpResult = await chrome.runtime.sendMessage({
          type: 'ZIP_SOLVE',
          tabId: tab.id,
          coords: result.coords,
        });
        if (cdpResult && cdpResult.error) {
          setStatus('error', 'CDP: ' + cdpResult.error);
        } else {
          setStatus('success', result.message || 'Zip solved!');
        }
      } catch (e) {
        setStatus('error', 'CDP failed: ' + e.message);
      }
    } else if (result && result.needsCDP && result.drags) {
      // Patches: needs trusted drags via chrome.debugger CDP
      setStatus('solving', 'Placing shapes...');
      try {
        const cdpResult = await chrome.runtime.sendMessage({
          type: 'PATCHES_SOLVE',
          tabId: tab.id,
          drags: result.drags,
        });
        if (cdpResult && cdpResult.error) {
          setStatus('error', 'CDP: ' + cdpResult.error);
        } else {
          setStatus('success', result.message || 'Patches solved!');
        }
      } catch (e) {
        setStatus('error', 'CDP failed: ' + e.message);
      }
    } else if (result && result.success) {
      setStatus('success', result.message || `${game} solved!`);
    } else if (result && result.error) {
      setStatus('error', result.error);
    } else {
      setStatus('error', 'Timed out — no result after 30s');
    }
  } catch (err) {
    setStatus('error', err.message);
  }

  disableButtons(false);
}

// Debug button
document.getElementById('debug-btn').addEventListener('click', async () => {
  setStatus('solving', 'Running diagnostics...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: () => {
        const cells = document.querySelectorAll('[data-cell-idx]');
        const totalElements = document.querySelectorAll('*').length;
        if (totalElements < 50) return null; // Skip empty frames

        // Find numbered cells by text
        let numberedCells = 0;
        cells.forEach(c => {
          const t = c.textContent.trim();
          if (t && /^\d+$/.test(t)) numberedCells++;
        });

        // Detect game type
        let gameType = 'unknown';
        if (document.querySelector('.sudoku-cell')) gameType = 'sudoku';
        else if (document.querySelector('[aria-label="Gameboard"]')) gameType = 'tango';
        else if (document.querySelector('[aria-label="Press enter to gameboard"]')) gameType = 'queens';
        else if (document.querySelector('[data-testid="patches-game-board"]')) gameType = 'patches';
        else if (cells.length > 0) gameType = 'zip';

        // Check selectors per game
        const selectors = {
          cellIdx: cells.length,
          cellContent: document.querySelectorAll('[data-cell-content]').length,
          filledCell: document.querySelectorAll('[data-testid="filled-cell"]').length,
          trailCell: document.querySelectorAll('.trail-cell').length,
          sudokuCell: document.querySelectorAll('.sudoku-cell').length,
          gameboard: !!document.querySelector('[aria-label="Gameboard"]'),
          queensSection: !!document.querySelector('[aria-label="Press enter to gameboard"]'),
          numberedCells,
        };

        // Cell structure sample
        let cellSample = '';
        if (cells.length > 0) {
          const c = cells[0];
          cellSample = c.className.substring(0, 60) + ' | kids:' + c.children.length;
        }

        // Check for __linkedinSolverResult
        const result = window.__linkedinSolverResult;

        return {
          url: location.href.substring(0, 60),
          gameType,
          selectors,
          cellSample,
          totalElements,
          prevResult: result ? JSON.stringify(result).substring(0, 100) : null,
        };
      },
    });

    let msg = `v${VERSION} | Frames: ${results.length}`;
    for (let i = 0; i < results.length; i++) {
      const d = results[i]?.result;
      if (!d) continue;
      msg += `\n\nFrame ${i}: ${d.gameType} | ${d.url}`;
      msg += `\n  cells:${d.selectors.cellIdx} filled:${d.selectors.filledCell} nums:${d.selectors.numberedCells}`;
      msg += `\n  dcc:${d.selectors.cellContent} trail:${d.selectors.trailCell} sudoku:${d.selectors.sudokuCell}`;
      msg += `\n  gb:${d.selectors.gameboard} queens:${d.selectors.queensSection}`;
      if (d.cellSample) msg += `\n  cell0: ${d.cellSample}`;
      if (d.prevResult) msg += `\n  prevResult: ${d.prevResult}`;
    }
    setStatus('success', msg);
  } catch (e) {
    setStatus('error', `Debug failed: ${e.message}`);
  }
});

// Game buttons
document.querySelectorAll('.game-card').forEach(btn => {
  btn.addEventListener('click', () => {
    const game = btn.dataset.game;
    solveGame(game);
  });
});

// Auto-detect: if already on a game page, start solving immediately
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    for (const [game, url] of Object.entries(GAME_URLS)) {
      const slug = url.replace('https://www.linkedin.com', '');
      if (tab.url.includes(slug)) {
        solveGame(game);
        return;
      }
    }
  } catch {}
})();
