const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class WebSocketPeer extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("close", () => this.emit("close"));
    socket.on("error", () => this.emit("close"));
  }

  send(event) {
    this.sendText(JSON.stringify(event));
  }

  sendText(text) {
    this.socket.write(encodeFrame(text));
  }

  close() {
    this.socket.end();
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const frame = decodeFrame(this.buffer);
      if (!frame) {
        return;
      }

      this.buffer = this.buffer.subarray(frame.bytesRead);

      if (frame.opcode === 0x8) {
        this.close();
        return;
      }

      if (frame.opcode === 0x9) {
        this.socket.write(encodeFrame(frame.payload.toString(), 0xA));
        continue;
      }

      if (frame.opcode === 0x1) {
        const text = frame.payload.toString("utf8");
        try {
          this.emit("event", JSON.parse(text));
        } catch (error) {
          this.emit("event", null);
        }
      }
    }
  }
}

function acceptUpgrade(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return null;
  }

  const accept = crypto.createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  );

  return new WebSocketPeer(socket);
}

function encodeFrame(text, opcode) {
  const payload = Buffer.from(text);
  const header = [];
  header.push(0x80 | (opcode || 0x1));

  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length < 65536) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    header.push(127, 0, 0, 0, 0);
    header.push(
      (payload.length >> 24) & 0xff,
      (payload.length >> 16) & 0xff,
      (payload.length >> 8) & 0xff,
      payload.length & 0xff
    );
  }

  return Buffer.concat([Buffer.from(header), payload]);
}

function decodeFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = Boolean(second & 0x80);
  let payloadLength = second & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    if (high !== 0) {
      throw new Error("WebSocket payload too large");
    }
    payloadLength = low;
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + payloadLength) {
    return null;
  }

  let payload = buffer.subarray(offset + maskLength, offset + maskLength + payloadLength);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    opcode,
    payload,
    bytesRead: offset + maskLength + payloadLength,
  };
}

module.exports = {
  acceptUpgrade,
  encodeFrame,
  decodeFrame,
};
