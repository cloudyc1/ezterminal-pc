const http = require("node:http");
const { RelayHub } = require("./hub");
const { createNotificationServiceFromEnv } = require("./notification-service");
const { acceptUpgrade } = require("./ws-protocol");

function createRelayServer(options) {
  const config = options || {};
  const hub =
    config.hub ||
    new RelayHub({
      notificationService:
        config.notificationService || createNotificationServiceFromEnv(config.env),
    });
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not Found");
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const peer = acceptUpgrade(req, socket);

    if (!peer) {
      return;
    }

    if (url.pathname === "/agent") {
      hub.attachAgent(peer);
      return;
    }

    if (url.pathname === "/client") {
      hub.attachClient(peer);
      return;
    }

    peer.close();
  });

  return {
    server,
    hub,
  };
}

module.exports = {
  createRelayServer,
};
