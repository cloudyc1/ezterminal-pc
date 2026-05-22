const PERMISSION_PATTERNS = [
  /permission/i,
  /approval/i,
  /approve/i,
  /allow/i,
  /confirm/i,
  /continue\?/i,
  /proceed\?/i,
  /do you want/i,
  /\by\/n\b/i,
  /\[y\/n\]/i,
  /\[y\/N\]/,
  /\(y\/n\)/i,
  /press enter/i,
  /权限/,
  /允许/,
  /确认/,
  /是否/,
  /继续/,
];

const COMPLETE_PATTERNS = [
  /task complete/i,
  /completed/i,
  /finished/i,
  /all tests pass/i,
  /ready for next/i,
  /已完成/,
  /完成/,
  /结束/,
];

function detectTerminalAlert(output) {
  const tail = getOutputTail(output);

  if (!tail) {
    return null;
  }

  if (matchesAny(tail, PERMISSION_PATTERNS)) {
    return {
      type: "permission",
      title: "终端需要确认",
      message: "出现权限、确认或继续执行提示",
      signature: buildSignature("permission", tail),
      sample: tail,
    };
  }

  if (matchesAny(tail, COMPLETE_PATTERNS)) {
    return {
      type: "complete",
      title: "终端任务可能已完成",
      message: "检测到完成或结束提示",
      signature: buildSignature("complete", tail),
      sample: tail,
    };
  }

  return null;
}

function getOutputTail(output) {
  return String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-10)
    .join("\n")
    .slice(-600);
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function buildSignature(type, text) {
  return `${type}:${text.slice(-160)}`;
}

module.exports = {
  detectTerminalAlert,
  getOutputTail,
};
