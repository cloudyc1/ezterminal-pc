const { createProtocolEvent } = require("../shared/protocol");
const { LocalNotificationService } = require("./notification-service");

const DEFAULT_BIND_CODE_TTL_MS = 10 * 60 * 1000;
const EXPIRED_BIND_CODE_REASON = "绑定码已过期，请在电脑端运行 ./link restart 获取新绑定码";

class RelayHub {
  constructor(options) {
    const config = options || {};

    this.agentsByDeviceId = new Map();
    this.agentsByBindCode = new Map();
    this.clients = new Set();
    this.sessionDeviceMap = new Map();
    this.deviceOwners = new Map();
    this.notificationService = config.notificationService || new LocalNotificationService();
    this.bindCodeTtlMs = normalizePositiveNumber(config.bindCodeTtlMs, DEFAULT_BIND_CODE_TTL_MS);
    this.now = typeof config.now === "function" ? config.now : () => Date.now();
  }

  attachAgent(peer) {
    peer.boundDevices = new Set();
    peer.on("event", (event) => this.handleAgentEvent(peer, event));
    peer.on("close", () => this.removeAgent(peer));
  }

  attachClient(peer) {
    peer.boundDevices = new Set();
    this.clients.add(peer);
    peer.on("event", (event) => this.handleClientEvent(peer, event));
    peer.on("close", () => this.clients.delete(peer));
    peer.send(
      createProtocolEvent("relay.status", {
        status: "online",
        label: "Relay 已连接",
      })
    );
  }

  handleAgentEvent(peer, event) {
    if (!event || !event.type) {
      return;
    }

    if (event.type === "agent.register") {
      const device = normalizeDevice(event.payload);
      this.removeBindCodesForAgent(peer);
      this.removeBindCodesForDevice(device.device_id);
      peer.device = device;
      this.agentsByDeviceId.set(device.device_id, peer);
      if (event.payload && event.payload.bind_code) {
        this.agentsByBindCode.set(String(event.payload.bind_code), {
          agent: peer,
          deviceId: device.device_id,
          expiresAtMs: getBindCodeExpiresAtMs(event.payload, this.now(), this.bindCodeTtlMs),
        });
      }
      peer.send(createProtocolEvent("agent.registered", device));
      this.broadcastDeviceStatus(device.device_id, "online");
      return;
    }

    if (event.type === "terminal.alert") {
      this.forwardAlertToOwner(event);
      return;
    }

    if (event.type === "session.list" && event.device_id) {
      this.forwardDeviceEventToBoundClients(event);
      return;
    }

    if (event.session_id) {
      this.forwardToBoundClients(event);
    }
  }

  handleClientEvent(peer, event) {
    if (!event || !event.type) {
      return;
    }

    if (event.type === "device.bind") {
      this.bindClientToDevice(peer, event.payload && event.payload.code, getEventClientId(peer, event));
      return;
    }

    if (event.type === "client.hello") {
      peer.clientId = event.payload && event.payload.client_id;
      peer.send(
        createProtocolEvent("client.ready", {
          client_id: peer.clientId,
        })
      );
      this.restoreBoundDevicesForClient(peer);
      return;
    }

    if (event.type === "notification.subscribe") {
      this.subscribeClientToNotifications(peer, event);
      return;
    }

    if (event.type === "session.list") {
      this.forwardToAgent(event.device_id, event, peer);
      return;
    }

    if (event.type === "session.create" || event.type === "session.attach") {
      const sessionId = event.payload && event.payload.session_id;
      const effectiveSessionId = sessionId || event.session_id;
      if (!this.canUseDevice(peer, event.device_id)) {
        peer.send(
          createProtocolEvent("device.access.denied", {
            device_id: event.device_id,
            reason: "当前小程序未绑定这台电脑",
          })
        );
        return;
      }
      if (effectiveSessionId && event.device_id) {
        this.sessionDeviceMap.set(effectiveSessionId, event.device_id);
      }
      this.forwardToAgent(event.device_id, event, peer);
      return;
    }

    if (event.type === "terminal.input" || event.type === "terminal.signal") {
      this.forwardSessionEventToAgent(event, peer);
      return;
    }

    if (event.type === "device.keep_awake") {
      this.forwardToAgent(event.device_id, event, peer);
    }
  }

  bindClientToDevice(peer, code, clientId) {
    const codeText = String(code || "");
    const registration = this.agentsByBindCode.get(codeText);

    if (!registration) {
      peer.send(
        createProtocolEvent("device.bind.failed", {
          reason: "绑定码无效或 Agent 未在线",
        })
      );
      return;
    }

    if (registration.expiresAtMs <= this.now()) {
      this.agentsByBindCode.delete(codeText);
      peer.send(
        createProtocolEvent("device.bind.failed", {
          reason: EXPIRED_BIND_CODE_REASON,
        })
      );
      return;
    }

    const agent = registration.agent;
    if (!agent || !agent.device) {
      this.agentsByBindCode.delete(codeText);
      peer.send(
        createProtocolEvent("device.bind.failed", {
          reason: "绑定码无效或 Agent 未在线",
        })
      );
      return;
    }

    const ownerClientId = this.deviceOwners.get(agent.device.device_id);
    const effectiveClientId = clientId || peer.clientId || "local-client";
    if (ownerClientId && ownerClientId !== effectiveClientId) {
      peer.send(
        createProtocolEvent("device.bind.failed", {
          reason: "这台电脑已经绑定到另一个客户端",
        })
      );
      return;
    }

    peer.clientId = effectiveClientId;
    peer.boundDevices.add(agent.device.device_id);
    this.deviceOwners.set(agent.device.device_id, effectiveClientId);
    peer.send(createProtocolEvent("device.bound", agent.device));
  }

  forwardSessionEventToAgent(event, peer) {
    const deviceId = this.sessionDeviceMap.get(event.session_id);
    if (!this.canUseDevice(peer, deviceId)) {
      peer.send(
        createProtocolEvent("device.access.denied", {
          device_id: deviceId,
          reason: "当前小程序未绑定这台电脑",
        })
      );
      return;
    }

    this.forwardToAgent(deviceId, event, peer);
  }

  forwardToAgent(deviceId, event, peer) {
    if (peer && !this.canUseDevice(peer, deviceId)) {
      peer.send(
        createProtocolEvent("device.access.denied", {
          device_id: deviceId,
          reason: "当前小程序未绑定这台电脑",
        })
      );
      return;
    }

    const agent = this.agentsByDeviceId.get(deviceId);

    if (!agent) {
      peer.send(
        createProtocolEvent("device.offline", {
          device_id: deviceId,
        })
      );
      return;
    }

    agent.send(event);
  }

  canUseDevice(peer, deviceId) {
    if (!deviceId) {
      return false;
    }

    return Boolean(peer && peer.boundDevices && peer.boundDevices.has(deviceId));
  }

  forwardToBoundClients(event) {
    const deviceId = this.sessionDeviceMap.get(event.session_id) || event.device_id;
    if (!deviceId) {
      return;
    }

    this.clients.forEach((client) => {
      if (client.boundDevices.has(deviceId)) {
        client.send(event);
      }
    });
  }

  forwardDeviceEventToBoundClients(event) {
    this.clients.forEach((client) => {
      if (client.boundDevices.has(event.device_id)) {
        client.send(event);
      }
    });
  }

  forwardAlertToOwner(event) {
    const deviceId = this.sessionDeviceMap.get(event.session_id) || event.device_id;
    const alert = Object.assign({}, event, {
      device_id: deviceId,
    });

    this.notificationService.sendTerminalAlert({
      device_id: deviceId,
      session_id: event.session_id,
      payload: event.payload,
    });

    this.clients.forEach((client) => {
      if (client.boundDevices.has(deviceId)) {
        client.send(alert);
      }
    });
  }

  subscribeClientToNotifications(peer, event) {
    const deviceId = event.device_id;
    if (!this.canUseDevice(peer, deviceId)) {
      peer.send(
        createProtocolEvent("notification.subscribe.status", {
          enabled: false,
          reason: "请先绑定电脑",
        })
      );
      return;
    }

    const subscription = this.notificationService.register(
      Object.assign({}, event.payload || {}, {
        client_id: getEventClientId(peer, event),
        device_id: deviceId,
      })
    );

    peer.send(
      createProtocolEvent(
        "notification.subscribe.status",
        {
          enabled: true,
          local_only: subscription.local_only,
        },
        {
          device_id: deviceId,
        }
      )
    );
  }

  broadcastDeviceStatus(deviceId, status) {
    const agent = this.agentsByDeviceId.get(deviceId);
    const device = agent && agent.device ? Object.assign({}, agent.device, { status }) : null;

    if (!device) {
      return;
    }

    this.clients.forEach((client) => {
      if (client.boundDevices.has(deviceId)) {
        client.send(createProtocolEvent("device.bound", device));
      }
    });
  }

  removeAgent(peer) {
    if (!peer.device) {
      return;
    }

    const deviceId = peer.device.device_id;
    this.agentsByDeviceId.delete(deviceId);
    this.removeBindCodesForAgent(peer);
    this.clients.forEach((client) => {
      if (client.boundDevices.has(deviceId)) {
        client.send(
          createProtocolEvent("device.bound", Object.assign({}, peer.device, { status: "offline" }))
        );
      }
    });
  }

  removeBindCodesForAgent(peer) {
    this.agentsByBindCode.forEach((registration, code) => {
      if (registration.agent === peer) {
        this.agentsByBindCode.delete(code);
      }
    });
  }

  removeBindCodesForDevice(deviceId) {
    this.agentsByBindCode.forEach((registration, code) => {
      if (registration.deviceId === deviceId) {
        this.agentsByBindCode.delete(code);
      }
    });
  }

  restoreBoundDevicesForClient(peer) {
    if (!peer || !peer.clientId) {
      return;
    }

    this.deviceOwners.forEach((ownerClientId, deviceId) => {
      if (ownerClientId !== peer.clientId) {
        return;
      }

      const agent = this.agentsByDeviceId.get(deviceId);
      if (!agent || !agent.device) {
        return;
      }

      peer.boundDevices.add(deviceId);
      peer.send(createProtocolEvent("device.bound", Object.assign({}, agent.device, { status: "online" })));
    });
  }
}

function getEventClientId(peer, event) {
  return (
    (event && event.client_id) ||
    (event && event.payload && event.payload.client_id) ||
    (peer && peer.clientId) ||
    "local-client"
  );
}

function normalizeDevice(payload) {
  const source = payload || {};

  return {
    device_id: source.device_id,
    device_name: source.device_name || "Remote Computer",
    os: source.os || process.platform,
    agent_version: source.agent_version || "0.1.0",
    status: "online",
    last_seen_at: new Date().toISOString(),
    keep_awake: false,
  };
}

function normalizePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function getBindCodeExpiresAtMs(payload, nowMs, ttlMs) {
  const source = payload || {};
  const explicitExpiresAt = Date.parse(source.bind_code_expires_at || "");
  if (!Number.isNaN(explicitExpiresAt)) {
    return explicitExpiresAt;
  }

  return nowMs + ttlMs;
}

module.exports = {
  RelayHub,
  EXPIRED_BIND_CODE_REASON,
};
