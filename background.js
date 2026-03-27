// Background service worker — dispatches trusted mouse events via Chrome Debugger Protocol

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ZIP_SOLVE') {
    handleZipDrag(msg.tabId, msg.cellIndices)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'PATCHES_SOLVE') {
    handlePatchesDrags(msg.tabId, msg.drags)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// Resolve cell coordinates across all frames (handles iframes)
async function resolveCellCoords(tabId, cellIndices) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: (indices) => {
      const cells = document.querySelectorAll('[data-cell-idx]');
      if (cells.length === 0) return null;

      // Compute iframe offset if we're inside an iframe
      let offsetX = 0, offsetY = 0;
      if (window !== window.top) {
        try {
          const frame = window.frameElement;
          if (frame) {
            const frameRect = frame.getBoundingClientRect();
            // frameElement.getBoundingClientRect() is in parent's viewport
            // but we also need to account for scrolling within the parent
            offsetX = frameRect.left;
            offsetY = frameRect.top;
          }
        } catch (e) {}
      }

      return indices.map(idx => {
        const cell = document.querySelector(`[data-cell-idx="${idx}"]`);
        if (!cell) return null;
        const rect = cell.getBoundingClientRect();
        return [
          Math.round(rect.left + rect.width / 2 + offsetX),
          Math.round(rect.top + rect.height / 2 + offsetY),
        ];
      });
    },
    args: [cellIndices],
  });

  // Find the frame that returned coordinates (non-null)
  for (const r of results) {
    if (r?.result && Array.isArray(r.result) && r.result.every(c => c !== null)) {
      return r.result;
    }
  }
  return null;
}

async function handleZipDrag(tabId, cellIndices) {
  const target = { tabId };

  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    if (!e.message.includes('Already attached')) throw e;
  }

  try {
    if (!cellIndices || cellIndices.length === 0) return { success: true };

    // Wait for debugger banner to settle, then resolve coordinates
    await sleep(300);

    const coords = await resolveCellCoords(tabId, cellIndices);
    if (!coords) {
      return { error: 'Could not resolve cell coordinates in any frame' };
    }

    const [x0, y0] = coords[0];

    // mousedown on first cell
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1,
    });
    await sleep(30);

    // mousemove through each subsequent cell (continuous drag)
    for (let i = 1; i < coords.length; i++) {
      const [x, y] = coords[i];
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, button: 'left', buttons: 1,
      });
      await sleep(20);
    }

    // mouseup on last cell
    const [xn, yn] = coords[coords.length - 1];
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: xn, y: yn, button: 'left', clickCount: 1,
    });
  } finally {
    try { await chrome.debugger.detach(target); } catch (_) {}
  }

  return { success: true };
}

async function handlePatchesDrags(tabId, drags) {
  const target = { tabId };

  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    if (!e.message.includes('Already attached')) throw e;
  }

  try {
    for (const { from, to } of drags) {
      const [x1, y1] = from;
      const [x2, y2] = to;

      // mousedown at start
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1,
      });
      await sleep(10);

      // mousemove to end (interpolate steps for smooth drag)
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(3, Math.round(dist / 20));
      for (let s = 1; s <= steps; s++) {
        const mx = Math.round(x1 + (x2 - x1) * s / steps);
        const my = Math.round(y1 + (y2 - y1) * s / steps);
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: mx, y: my, button: 'left', buttons: 1,
        });
      }
      await sleep(10);

      // mouseup at end
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1,
      });

      await sleep(80);
    }
  } finally {
    try { await chrome.debugger.detach(target); } catch (_) {}
  }

  return { success: true };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
