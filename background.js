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

async function handleZipDrag(tabId, cellIndices) {
  const target = { tabId };

  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    if (!e.message.includes('Already attached')) throw e;
  }

  try {
    if (!cellIndices || cellIndices.length === 0) return { success: true };

    // Resolve coordinates with CDP offset correction
    // The debugger banner can shift page content, causing getBoundingClientRect
    // to differ from CDP's coordinate space. We detect the offset using DOM.getBoxModel
    // on one cell, then apply it to all coordinates from Runtime.evaluate (fast batch).
    await sleep(200);

    // Step 1: Get all coordinates via fast batch Runtime.evaluate
    const evalResult = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: `(function() {
        return JSON.stringify(${JSON.stringify(cellIndices)}.map(function(idx) {
          var cell = document.querySelector('[data-cell-idx="' + idx + '"]');
          if (!cell) return null;
          var rect = cell.getBoundingClientRect();
          return [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)];
        }));
      })()`,
      returnByValue: true,
    });
    const jsCoords = JSON.parse(evalResult.result.value);
    if (!jsCoords || jsCoords.some(c => !c)) {
      return { error: 'Could not resolve cell coordinates' };
    }

    // Step 2: Get the first cell's position via CDP DOM.getBoxModel (true CDP coords)
    const { result: firstNode } = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: `document.querySelector('[data-cell-idx="${cellIndices[0]}"]')`,
    });
    let offsetX = 0, offsetY = 0;
    if (firstNode.objectId) {
      try {
        const boxModel = await chrome.debugger.sendCommand(target, 'DOM.getBoxModel', {
          objectId: firstNode.objectId,
        });
        const quad = boxModel.model.content;
        const cdpX = Math.round((quad[0] + quad[2] + quad[4] + quad[6]) / 4);
        const cdpY = Math.round((quad[1] + quad[3] + quad[5] + quad[7]) / 4);
        offsetX = cdpX - jsCoords[0][0];
        offsetY = cdpY - jsCoords[0][1];
      } catch(_) {}
      try { await chrome.debugger.sendCommand(target, 'Runtime.releaseObject', { objectId: firstNode.objectId }); } catch(_) {}
    }

    // Step 3: Apply offset to all coordinates
    const coords = jsCoords.map(([x, y]) => [x + offsetX, y + offsetY]);

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
