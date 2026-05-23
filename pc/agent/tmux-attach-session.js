const { EventEmitter } = require("node:events");
const { execFileSync } = require("node:child_process");

class TmuxAttachSession extends EventEmitter {
  constructor(options) {
    super();
    this.sessionId = options.sessionId;
    this.tmuxName = options.tmuxName;
    this.tmuxPath = options.tmuxPath || "tmux";
    this.intervalMs = options.intervalMs || 300;
    this.execFileSync = options.execFileSync || execFileSync;
    this.timer = null;
    this.pendingCaptures = [];
    this.lastOutput = "";
  }

  start() {
    this.capture();
    this.timer = setInterval(() => this.capture(), this.intervalMs);
  }

  write(data) {
    sendTextToTmux(this.tmuxPath, this.tmuxName, String(data || ""), this.execFileSync);
    this.capture();
    this.scheduleCapture(80);
    this.scheduleCapture(240);
  }

  signal(signal) {
    if (signal === "SIGINT") {
      this.execFileSync(this.tmuxPath, ["send-keys", "-t", this.tmuxName, "C-c"], {
        stdio: "ignore",
      });
      this.capture();
    }
  }

  refresh() {
    this.capture({
      force: true,
    });
  }

  close() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pendingCaptures.forEach((timer) => clearTimeout(timer));
    this.pendingCaptures = [];
  }

  scheduleCapture(delay) {
    const timer = setTimeout(() => {
      this.pendingCaptures = this.pendingCaptures.filter((item) => item !== timer);
      this.capture();
    }, delay);
    this.pendingCaptures.push(timer);
  }

  capture(options) {
    const config = options || {};

    try {
      const output = this.execFileSync(
        this.tmuxPath,
        ["capture-pane", "-t", this.tmuxName, "-p", "-S", "-200"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      if (config.force || output !== this.lastOutput) {
        this.lastOutput = output;
        this.emit("replace", output);
      }
    } catch (error) {
      this.emit("output", `[agent] tmux capture failed: ${error.message}\n`);
      this.close();
      this.emit("exit", 1);
    }
  }
}

function sendTextToTmux(tmuxPath, tmuxName, text, execCommand) {
  const run = execCommand || execFileSync;

  buildSendKeyCommands(tmuxPath, tmuxName, text).forEach(([command, args]) => {
    run(command, args, {
      stdio: "ignore",
    });
  });
}

function buildSendKeyCommands(tmuxPath, tmuxName, text) {
  const commands = [];
  let literal = "";

  Array.from(String(text || "")).forEach((char) => {
    if (char === "\n" || char === "\r" || char === "\x7f" || char === "\b") {
      flushLiteral(commands, tmuxPath, tmuxName, literal);
      literal = "";
      commands.push([
        tmuxPath,
        ["send-keys", "-t", tmuxName, char === "\n" || char === "\r" ? "Enter" : "BSpace"],
      ]);
      return;
    }

    literal += char;
  });

  flushLiteral(commands, tmuxPath, tmuxName, literal);
  return commands;
}

function flushLiteral(commands, tmuxPath, tmuxName, literal) {
  if (!literal) {
    return;
  }

  commands.push([tmuxPath, ["send-keys", "-t", tmuxName, "-l", literal]]);
}

module.exports = {
  TmuxAttachSession,
  sendTextToTmux,
  buildSendKeyCommands,
};
