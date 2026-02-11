const http = require("node:http");

function resolveHealthPort() {
  const raw = process.env.NAGOMI_ORCH_HEALTH_PORT;
  if (!raw) return 17707;
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : 17707;
}

async function httpGetBody(pathname, timeoutMs = 5000) {
  const port = resolveHealthPort();
  return await new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: pathname, agent: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode || 0, body });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout ${pathname}`));
    });
  });
}

async function openTerminalViaHealth(sessionId = "") {
  const path = sessionId
    ? `/open-terminal?session_id=${encodeURIComponent(sessionId)}`
    : "/open-terminal";
  const response = await httpGetBody(path, 10000);
  if (response.status !== 200) {
    throw new Error(`open-terminal failed: ${response.status} ${response.body}`);
  }
  let payload = null;
  try {
    payload = JSON.parse(response.body);
  } catch (error) {
    throw new Error(`open-terminal invalid json: ${response.body}`);
  }
  if (!payload || payload.status !== "ok" || !payload.session_id) {
    throw new Error(`open-terminal invalid payload: ${response.body}`);
  }
  return payload;
}

async function windowInfo(client) {
  return await client.executeScript(`
    const params = new URLSearchParams(window.location.search || '');
    return {
      href: window.location.href || '',
      view: params.get('view') || '',
      sessionId: params.get('session_id') || ''
    };
  `);
}

async function waitForTerminalWindow(client, sessionId = "", timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastWindows = [];
  while (Date.now() < deadline) {
    const handles = await client.getAllWindowHandles();
    const snapshots = [];
    for (const handle of handles) {
      try {
        await client.switchTo().window(handle);
        const info = await windowInfo(client);
        snapshots.push({ handle, ...info });
        if (info.view === "terminal" && (!sessionId || info.sessionId === sessionId)) {
          return { handle, ...info, windows: snapshots };
        }
      } catch {
        // Window may disappear while enumerating; continue.
      }
    }
    lastWindows = snapshots;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `terminal window not found: session=${sessionId || "(any)"} windows=${JSON.stringify(lastWindows)}`
  );
}

async function openAndSwitchToTerminalWindow(client, sessionId = "", timeoutMs = 20000) {
  const opened = await openTerminalViaHealth(sessionId);
  const found = await waitForTerminalWindow(client, opened.session_id, timeoutMs);
  return {
    requestedSessionId: sessionId || "",
    sessionId: opened.session_id,
    handle: found.handle,
    href: found.href,
    windows: found.windows,
  };
}

module.exports = {
  resolveHealthPort,
  httpGetBody,
  openTerminalViaHealth,
  waitForTerminalWindow,
  openAndSwitchToTerminalWindow,
};

