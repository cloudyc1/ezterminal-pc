function randomText(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return value;
}

function createId(prefix) {
  return `${prefix}_${randomText(16)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createProtocolEvent(type, payload, extra) {
  return Object.assign(
    {
      id: createId("evt"),
      type,
      payload: payload || {},
      created_at: nowIso(),
    },
    extra || {}
  );
}

function createSessionCreateEvent(deviceId, payload) {
  return createProtocolEvent("session.create", payload, {
    device_id: deviceId,
  });
}

function createTerminalInputEvent(sessionId, data) {
  return createProtocolEvent(
    "terminal.input",
    {
      data,
    },
    {
      session_id: sessionId,
    }
  );
}

function createTerminalSignalEvent(sessionId, signal) {
  return createProtocolEvent(
    "terminal.signal",
    {
      signal,
    },
    {
      session_id: sessionId,
    }
  );
}

function createClientHelloEvent(clientId) {
  return createProtocolEvent("client.hello", {
    client_id: clientId,
    platform: "wechat-miniprogram",
  });
}

function createNotificationSubscribeEvent(deviceId, payload) {
  return createProtocolEvent("notification.subscribe", payload || {}, {
    device_id: deviceId,
  });
}

function isValidProtocolEvent(event) {
  return Boolean(
    event &&
      typeof event.id === "string" &&
      event.id.indexOf("evt_") === 0 &&
      typeof event.type === "string" &&
      typeof event.created_at === "string" &&
      event.payload &&
      typeof event.payload === "object"
  );
}

module.exports = {
  createId,
  createProtocolEvent,
  createSessionCreateEvent,
  createTerminalInputEvent,
  createTerminalSignalEvent,
  createClientHelloEvent,
  createNotificationSubscribeEvent,
  isValidProtocolEvent,
};
