class LocalNotificationService {
  constructor() {
    this.subscriptions = new Map();
    this.alerts = [];
  }

  register(subscription) {
    const item = normalizeSubscription(subscription);
    const key = buildKey(item.client_id, item.device_id);

    this.subscriptions.set(key, item);
    return item;
  }

  getSubscription(clientId, deviceId) {
    return this.subscriptions.get(buildKey(clientId, deviceId)) || null;
  }

  sendTerminalAlert(alert) {
    const item = Object.assign(
      {
        created_at: new Date().toISOString(),
      },
      alert || {}
    );

    this.alerts.push(item);
    this.alerts = this.alerts.slice(-100);
    return item;
  }
}

class WechatNotificationService extends LocalNotificationService {
  constructor(options) {
    super();
    const config = options || {};

    this.webhookUrl = config.webhookUrl || "";
    this.secret = config.secret || "";
    this.postJson = config.postJson || postJsonWithFetch;
    this.pending = [];
  }

  sendTerminalAlert(alert) {
    const item = super.sendTerminalAlert(alert);

    if (!this.webhookUrl || !item.device_id) {
      return item;
    }

    const task = this.postJson(
      this.webhookUrl,
      buildWechatNotificationPayload(item, this.secret)
    ).catch((error) => {
      console.error(`[notify] WeChat webhook failed: ${error.message}`);
    });
    this.pending.push(task);
    task.finally(() => {
      this.pending = this.pending.filter((entry) => entry !== task);
    });

    return item;
  }

  async flush() {
    await Promise.all(this.pending);
  }
}

class CloudBaseNotificationService extends LocalNotificationService {
  constructor(options) {
    super();
    const config = options || {};

    this.envId = config.envId || "";
    this.secretId = config.secretId || "";
    this.secretKey = config.secretKey || "";
    this.secret = config.secret || "";
    this.functionName = config.functionName || "terminalNotify";
    this.createApp = config.createApp || createCloudBaseApp;
    this.app = null;
    this.pending = [];
  }

  sendTerminalAlert(alert) {
    const item = super.sendTerminalAlert(alert);

    if (!this.envId || !this.secretId || !this.secretKey || !item.device_id) {
      return item;
    }

    const task = this.callTerminalNotify(item).catch((error) => {
      console.error(`[notify] CloudBase function failed: ${error.message}`);
    });
    this.pending.push(task);
    task.finally(() => {
      this.pending = this.pending.filter((entry) => entry !== task);
    });

    return item;
  }

  async callTerminalNotify(alert) {
    if (!this.app) {
      this.app = this.createApp({
        env: this.envId,
        secretId: this.secretId,
        secretKey: this.secretKey,
      });
    }

    return this.app.callFunction({
      name: this.functionName,
      data: buildWechatNotificationPayload(alert, this.secret),
    });
  }

  async flush() {
    await Promise.all(this.pending);
  }
}

function createNotificationServiceFromEnv(env) {
  const source = env || process.env;
  const webhookUrl = source.WECHAT_NOTIFY_WEBHOOK || "";
  const envId = source.TCB_ENV_ID || source.CLOUDBASE_ENV_ID || "";
  const secretId =
    source.TENCENTCLOUD_SECRET_ID || source.TENCENTCLOUD_SECRETID || source.TCB_SECRET_ID || "";
  const secretKey =
    source.TENCENTCLOUD_SECRET_KEY ||
    source.TENCENTCLOUD_SECRETKEY ||
    source.TCB_SECRET_KEY ||
    "";

  if (envId && secretId && secretKey) {
    return new CloudBaseNotificationService({
      envId,
      secretId,
      secretKey,
      secret: source.WECHAT_NOTIFY_SECRET || "",
      functionName: source.WECHAT_NOTIFY_FUNCTION || "terminalNotify",
    });
  }

  if (!webhookUrl) {
    return new LocalNotificationService();
  }

  return new WechatNotificationService({
    webhookUrl,
    secret: source.WECHAT_NOTIFY_SECRET || "",
  });
}

function createCloudBaseApp(config) {
  const cloudbase = require("@cloudbase/node-sdk");

  return cloudbase.init(config);
}

function buildWechatNotificationPayload(alert, secret) {
  const source = alert || {};
  const payload = source.payload || {};

  return {
    action: "send",
    secret: secret || "",
    device_id: source.device_id || "",
    session_id: source.session_id || "",
    notification_type: selectNotificationType(payload.alert_type),
    alert: {
      alert_type: payload.alert_type || "",
      title: payload.title || "",
      message: payload.message || "",
      sample: payload.sample || "",
      tmux_name: payload.tmux_name || "",
    },
    created_at: source.created_at || new Date().toISOString(),
  };
}

function selectNotificationType(alertType) {
  return alertType === "complete" || alertType === "completion" ? "completion" : "approval";
}

async function postJsonWithFetch(url, payload) {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node.js 缺少 fetch，请使用 Node.js 18+");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function normalizeSubscription(subscription) {
  const source = subscription || {};

  return {
    client_id: String(source.client_id || ""),
    device_id: String(source.device_id || ""),
    local_only: source.local_only !== false,
    templates: source.templates || [],
    template_ids: source.template_ids || [],
    result: source.result || {},
    created_at: new Date().toISOString(),
  };
}

function buildKey(clientId, deviceId) {
  return `${clientId}:${deviceId}`;
}

module.exports = {
  CloudBaseNotificationService,
  LocalNotificationService,
  WechatNotificationService,
  buildWechatNotificationPayload,
  createNotificationServiceFromEnv,
};
