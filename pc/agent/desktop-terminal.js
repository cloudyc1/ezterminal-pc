const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function shouldOpenDesktopTerminal(env, platform) {
  const sourceEnv = env || process.env;
  const sourcePlatform = platform || process.platform;

  return sourcePlatform === "darwin" && sourceEnv.REMOTE_TERMINAL_OPEN_DESKTOP !== "0";
}

function openTmuxInDesktopTerminal(options) {
  const config = options || {};
  const env = config.env || process.env;
  const platform = config.platform || process.platform;

  if (!shouldOpenDesktopTerminal(env, platform)) {
    return {
      opened: false,
      reason: "desktop terminal disabled",
    };
  }

  const scriptPath = writeAttachScript(config);
  const spawnFn = config.spawn || spawn;
  const child = spawnFn("open", ["-a", "Terminal", scriptPath], {
    detached: true,
    stdio: "ignore",
  });

  if (child && typeof child.unref === "function") {
    child.unref();
  }

  return {
    opened: true,
    scriptPath,
  };
}

function writeAttachScript(options) {
  const config = options || {};
  const tmuxPath = config.tmuxPath || "tmux";
  const tmuxName = config.tmuxName || "mobile";
  const cwd = config.cwd || os.homedir();
  const tmpDir = config.tmpDir || os.tmpdir();
  const filename = `remote-terminal-${sanitizeFilename(tmuxName)}-${Date.now()}.command`;
  const scriptPath = path.join(tmpDir, filename);
  const script = [
    "#!/bin/zsh",
    `cd ${shellQuote(cwd)} 2>/dev/null || cd ~`,
    `exec ${shellQuote(tmuxPath)} attach-session -t ${shellQuote(tmuxName)}`,
    "",
  ].join("\n");

  fs.writeFileSync(scriptPath, script, {
    mode: 0o700,
  });
  fs.chmodSync(scriptPath, 0o700);

  return scriptPath;
}

function shellQuote(value) {
  return `'${String(value == null ? "" : value).replace(/'/g, "'\\''")}'`;
}

function sanitizeFilename(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "mobile"
  );
}

module.exports = {
  openTmuxInDesktopTerminal,
  shouldOpenDesktopTerminal,
  writeAttachScript,
  shellQuote,
};
