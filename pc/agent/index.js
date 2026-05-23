const { ShellSession } = require("./shell-session");
const { TmuxAttachSession } = require("./tmux-attach-session");
const { TmuxManager, sanitizeSessionName } = require("./tmux-manager");
const { openTmuxInDesktopTerminal } = require("./desktop-terminal");
const { detectTerminalAlert } = require("./terminal-alerts");
const { createProtocolEvent } = require("../shared/protocol");
const { loadDevice, createBindCode, getOsLabel } = require("./device");

const relayUrl = process.env.RELAY_URL || "ws://127.0.0.1:8787/agent";
const bindCode = process.env.BIND_CODE || createBindCode();
const bindCodeTtlSeconds = normalizeBindCodeTtlSeconds(process.env.BIND_CODE_TTL_SECONDS);
const bindCodeExpiresAt = process.env.BIND_CODE_EXPIRES_AT || createBindCodeExpiresAt(bindCodeTtlSeconds);
const device = loadDevice();
const sessions = new Map();
const tmux = new TmuxManager();
const desktopOpenRequests = new Map();
const alertSignatures = new Map();

let socket = null;

function connect() {
  if (typeof WebSocket === "undefined") {
    console.error("当前 Node.js 版本缺少全局 WebSocket，请使用 Node.js 22+。");
    process.exit(1);
  }

  socket = new WebSocket(relayUrl);

  socket.addEventListener("open", () => {
    console.log(`Agent connected: ${relayUrl}`);
    console.log(`Bind code: ${bindCode}`);
    console.log(`Bind code expires at: ${bindCodeExpiresAt}`);
    send(
      createProtocolEvent("agent.register", {
        device_id: device.device_id,
        device_name: device.device_name,
        os: getOsLabel(),
        agent_version: "0.1.0",
        bind_code: bindCode,
        bind_code_expires_at: bindCodeExpiresAt,
      })
    );
  });

  socket.addEventListener("message", (message) => {
    const event = safeJsonParse(message.data);
    if (event) {
      handleRelayEvent(event);
    }
  });

  socket.addEventListener("close", () => {
    console.log("Agent disconnected. Reconnecting in 2s...");
    setTimeout(connect, 2000);
  });

  socket.addEventListener("error", () => {
    console.log("Agent socket error.");
  });
}

function handleRelayEvent(event) {
  if (event.type === "session.list") {
    sendSessionList();
    return;
  }

  if (event.type === "session.create") {
    createTmuxSession(event);
    return;
  }

  if (event.type === "session.attach") {
    attachTmuxSession(event);
    return;
  }

  if (event.type === "session.close") {
    closeTmuxSession(event);
    return;
  }

  if (event.type === "terminal.input") {
    const session = sessions.get(event.session_id);
    if (session) {
      session.write(event.payload.data);
    }
    return;
  }

  if (event.type === "terminal.signal") {
    const session = sessions.get(event.session_id);
    if (session) {
      session.signal(event.payload.signal);
    }
    return;
  }

}

function createSession(event) {
  const payload = event.payload || {};
  const sessionId = payload.session_id || event.session_id;

  if (!sessionId || sessions.has(sessionId)) {
    return;
  }

  const session = new ShellSession({
    sessionId,
    shell: payload.shell || process.env.SHELL || "/bin/sh",
    cwd: payload.cwd || process.cwd(),
  });

  sessions.set(sessionId, session);
  session.on("output", (data) => {
    send(
      createProtocolEvent(
        "terminal.output",
        {
          data,
        },
        {
          session_id: sessionId,
        }
      )
    );
  });
  session.on("exit", (code) => {
    send(
      createProtocolEvent(
        "session.status",
        {
          status: "closed",
          exit_code: code,
        },
        {
          session_id: sessionId,
        }
      )
    );
    sessions.delete(sessionId);
    alertSignatures.delete(sessionId);
  });
  session.start();
  send(
    createProtocolEvent(
      "session.status",
      {
        status: "running",
        cwd: session.cwd,
        shell: session.shell,
      },
      {
        session_id: sessionId,
      }
    )
  );
}

function sendSessionList() {
  send(
    createProtocolEvent(
      "session.list",
      {
        sessions: tmux.listSessions(),
      },
      {
        device_id: device.device_id,
      }
    )
  );
}

function createTmuxSession(event) {
  const payload = event.payload || {};
  const tmuxName = sanitizeSessionName(payload.tmux_name || payload.title || "mobile");

  try {
    const remoteSession = tmux.ensureSession(tmuxName, payload.cwd || process.cwd());
    maybeOpenDesktopTerminal(tmuxName, payload.cwd, payload.open_desktop);
    attachTmuxSession({
      type: "session.attach",
      session_id: remoteSession.session_id,
      payload: remoteSession,
    });
    sendSessionList();
  } catch (error) {
    send(
      createProtocolEvent(
        "terminal.output",
        {
          data: `[agent] tmux create failed: ${error.message}\n`,
        },
        {
          session_id: event.session_id || (event.payload && event.payload.session_id),
        }
      )
    );
  }
}

function attachTmuxSession(event) {
  const payload = event.payload || {};
  const tmuxName = sanitizeSessionName(payload.tmux_name || payload.title || "mobile");
  const sessionId = event.session_id || payload.session_id || `tmux_${tmuxName}`;

  maybeOpenDesktopTerminal(tmuxName, payload.cwd, payload.open_desktop);

  if (!sessionId) {
    return;
  }

  const existingSession = sessions.get(sessionId);
  if (existingSession) {
    if (typeof existingSession.refresh === "function") {
      existingSession.refresh();
    }
    return;
  }

  const session = new TmuxAttachSession({
    sessionId,
    tmuxName,
    tmuxPath: tmux.tmuxPath,
  });

  sessions.set(sessionId, session);
  session.on("replace", (data) => {
    send(
      createProtocolEvent(
        "terminal.replace",
        {
          data,
        },
        {
          session_id: sessionId,
        }
      )
    );
    maybeSendTerminalAlert(sessionId, data, tmuxName);
  });
  session.on("output", (data) => {
    send(
      createProtocolEvent(
        "terminal.output",
        {
          data,
        },
        {
          session_id: sessionId,
        }
      )
    );
  });
  session.on("exit", (code) => {
    send(
      createProtocolEvent(
        "session.status",
        {
          status: "detached",
          exit_code: code,
        },
        {
          session_id: sessionId,
        }
      )
    );
    sessions.delete(sessionId);
    alertSignatures.delete(sessionId);
  });
  session.start();
  send(
    createProtocolEvent(
      "session.status",
      {
        status: "running",
        cwd: "tmux session",
        shell: "tmux",
        tmux_name: tmuxName,
      },
      {
        session_id: sessionId,
      }
    )
  );
}

function closeTmuxSession(event) {
  const payload = event.payload || {};
  const tmuxName = sanitizeSessionName(payload.tmux_name || payload.title || "mobile");
  const sessionId = event.session_id || payload.session_id || `tmux_${tmuxName}`;
  const attachedSession = sessions.get(sessionId);

  if (attachedSession) {
    attachedSession.close();
    sessions.delete(sessionId);
    alertSignatures.delete(sessionId);
  }

  const killed = tmux.killSession(tmuxName);
  send(
    createProtocolEvent(
      "session.status",
      {
        status: "closed",
        shell: "tmux",
        tmux_name: tmuxName,
        killed,
      },
      {
        device_id: device.device_id,
        session_id: sessionId,
      }
    )
  );
  sendSessionList();
}

function maybeSendTerminalAlert(sessionId, output, tmuxName) {
  const alert = detectTerminalAlert(output);
  if (!alert) {
    return;
  }

  const lastSignature = alertSignatures.get(sessionId);
  if (lastSignature === alert.signature) {
    return;
  }

  alertSignatures.set(sessionId, alert.signature);
  send(
    createProtocolEvent(
      "terminal.alert",
      {
        alert_type: alert.type,
        title: alert.title,
        message: alert.message,
        sample: alert.sample,
        tmux_name: tmuxName,
      },
      {
        session_id: sessionId,
        device_id: device.device_id,
      }
    )
  );
}

function maybeOpenDesktopTerminal(tmuxName, cwd, openDesktop) {
  if (openDesktop === false) {
    return;
  }

  if (tmux.isAttached(tmuxName)) {
    return;
  }

  const lastRequestedAt = desktopOpenRequests.get(tmuxName) || 0;
  const now = Date.now();
  if (now - lastRequestedAt < 15000) {
    return;
  }

  desktopOpenRequests.set(tmuxName, now);
  try {
    openTmuxInDesktopTerminal({
      tmuxPath: tmux.tmuxPath,
      tmuxName,
      cwd: cwd || process.cwd(),
    });
  } catch (error) {
    send(
      createProtocolEvent(
        "terminal.output",
        {
          data: `[agent] open desktop terminal failed: ${error.message}\n`,
        },
        {
          session_id: `tmux_${tmuxName}`,
        }
      )
    );
  }
}

function send(event) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function normalizeBindCodeTtlSeconds(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 600;
}

function createBindCodeExpiresAt(ttlSeconds) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

process.on("SIGINT", () => {
  sessions.forEach((session) => session.close());
  if (socket) {
    socket.close();
  }
  process.exit(0);
});

connect();
