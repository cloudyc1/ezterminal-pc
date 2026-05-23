const { createRelayServer } = require("./create-server");
const { formatNotificationStatus } = require("./notification-service");

const port = Number(process.env.RELAY_PORT || 8787);
const host = process.env.RELAY_HOST || "127.0.0.1";
const { server, hub } = createRelayServer();

server.listen(port, host, () => {
  console.log(`Relay listening on ws://${host}:${port}`);
  console.log(`Agent endpoint: ws://${host}:${port}/agent`);
  console.log(`Client endpoint: ws://${host}:${port}/client`);
  console.log(`WeChat notify: ${formatNotificationStatus(hub.notificationService.getStatus())}`);
});
