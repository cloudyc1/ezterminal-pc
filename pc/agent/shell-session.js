const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

let nodePty = null;
try {
  nodePty = require("node-pty");
} catch (error) {
  nodePty = null;
}

class ShellSession extends EventEmitter {
  constructor(options) {
    super();
    this.sessionId = options.sessionId;
    this.shell = options.shell || options.command || process.env.SHELL || "/bin/sh";
    this.args = options.args || [];
    this.cwd = normalizeCwd(options.cwd);
    this.process = null;
    this.backend = "child_process";
  }

  start() {
    if (nodePty) {
      try {
        this.startPty();
        return;
      } catch (error) {
        this.emit("output", `[agent] node-pty unavailable, fallback to pipe shell: ${error.message}\n`);
        this.process = null;
        this.backend = "child_process";
      }
    }

    this.startChildProcess();
  }

  startPty() {
    this.backend = "node-pty";
    this.process = nodePty.spawn(this.shell, this.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: this.cwd,
      env: process.env,
    });
    this.process.onData((data) => this.emit("output", data));
    this.process.onExit((event) => {
      this.emit("exit", event.exitCode);
    });
  }

  startChildProcess() {
    this.process = spawn(this.shell, this.args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stdout.on("data", (chunk) => this.emit("output", chunk.toString()));
    this.process.stderr.on("data", (chunk) => this.emit("output", chunk.toString()));
    this.process.on("exit", (code) => this.emit("exit", code));
  }

  write(data) {
    if (!this.process) {
      return;
    }

    if (this.backend === "node-pty") {
      this.process.write(data);
      return;
    }

    if (this.process.stdin.writable) {
      this.process.stdin.write(data);
    }
  }

  signal(signal) {
    if (!this.process) {
      return;
    }

    if (this.backend === "node-pty" && signal === "SIGINT") {
      this.process.write("\x03");
      return;
    }

    if (this.backend !== "node-pty") {
      this.process.kill(signal || "SIGINT");
    }
  }

  close() {
    if (!this.process) {
      return;
    }

    if (this.backend === "node-pty") {
      this.process.kill();
    } else {
      this.process.kill("SIGHUP");
    }
    this.process = null;
  }
}

function normalizeCwd(cwd) {
  if (cwd && fs.existsSync(cwd)) {
    return cwd;
  }

  return process.cwd();
}

module.exports = {
  ShellSession,
};
