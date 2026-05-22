const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const CONFIG_DIR = process.env.EZTERMINAL_HOME || path.join(os.homedir(), ".ezterminal");
const CONFIG_FILE = path.join(CONFIG_DIR, "device.json");

function loadDevice() {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  }

  const device = {
    device_id: `dev_${crypto.randomBytes(16).toString("hex")}`,
    device_name: os.hostname(),
    created_at: new Date().toISOString(),
  };

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(device, null, 2));
  return device;
}

function createBindCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getOsLabel() {
  if (process.platform === "darwin") {
    return "macOS";
  }

  if (process.platform === "win32") {
    return "Windows";
  }

  return process.platform;
}

module.exports = {
  loadDevice,
  createBindCode,
  getOsLabel,
};
