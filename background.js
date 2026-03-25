// Background service worker — dispatches trusted mouse events via Chrome Debugger Protocol

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ZIP_SOLVE') {
    handleZipDrag(msg.tabId, msg.coords)
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

async function handleZipDrag(tabId, coords) {
  const target = { tabId };

  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    if (!e.message.includes('Already attached')) throw e;
  }

  try {
    if (coords.length === 0) return { success: true };

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
