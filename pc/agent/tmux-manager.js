const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const LIST_FORMAT = "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}";
const TMUX_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
];

function parseTmuxSessions(output) {
  return String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, windows, attached, created] = line.split("\t");

      return {
        session_id: buildTmuxSessionId(name),
        tmux_name: name,
        title: name,
        shell: "tmux",
        cwd: "tmux session",
        status: "running",
        attached: Number(attached) > 0,
        windows: Number(windows) || 0,
        created_at: created || "",
      };
    });
}

function sanitizeSessionName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return normalized || "mobile";
}

function buildTmuxSessionId(name) {
  return `tmux_${sanitizeSessionName(name)}`;
}

class TmuxManager {
  constructor(options) {
    this.tmuxPath = (options && options.tmuxPath) || "tmux";
  }

  listSessions() {
    try {
      return parseTmuxSessions(
        execFileSync(this.tmuxPath, ["list-sessions", "-F", LIST_FORMAT], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      );
    } catch (error) {
      return [];
    }
  }

  hasSession(name) {
    try {
      execFileSync(this.tmuxPath, ["has-session", "-t", name], {
        stdio: "ignore",
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  isAttached(name) {
    try {
      const output = execFileSync(
        this.tmuxPath,
        ["display-message", "-p", "-t", sanitizeSessionName(name), "#{session_attached}"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      return Number(String(output).trim()) > 0;
    } catch (error) {
      return false;
    }
  }

  ensureSession(name, cwd) {
    const sessionName = sanitizeSessionName(name);

    if (!this.hasSession(sessionName)) {
      const args = ["new-session", "-d", "-s", sessionName];
      args.push(...buildTmuxEnvironmentArgs(process.env));
      if (cwd && fs.existsSync(cwd)) {
        args.push("-c", cwd);
      }
      execFileSync(this.tmuxPath, args, {
        stdio: "ignore",
      });
    }

    return {
      session_id: buildTmuxSessionId(sessionName),
      tmux_name: sessionName,
      title: sessionName,
      shell: "tmux",
      cwd: cwd || "tmux session",
      status: "running",
    };
  }

  buildAttachCommand(name) {
    return {
      command: this.tmuxPath,
      args: ["attach-session", "-t", sanitizeSessionName(name)],
    };
  }
}

function buildTmuxEnvironmentArgs(env) {
  const source = env || {};
  const args = [];

  TMUX_ENV_KEYS.forEach((key) => {
    if (!source[key]) {
      return;
    }

    args.push("-e", `${key}=${source[key]}`);
  });

  return args;
}

module.exports = {
  TmuxManager,
  buildTmuxEnvironmentArgs,
  buildTmuxSessionId,
  parseTmuxSessions,
  sanitizeSessionName,
};
