import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { pipeCall, localCollector } from "./local-collector.mjs";

test("pipe transport reads fragmented replies and acknowledges them", async () => {
  const path =
    process.platform === "win32"
      ? `\\\\.\\pipe\\Trace-test-${randomUUID()}`
      : `/tmp/trace-${randomUUID()}.sock`;
  let acknowledged = false;
  let received;
  const server = net.createServer((socket) => {
    let input = Buffer.alloc(0);
    let replied = false;
    socket.on("data", (chunk) => {
      if (replied) {
        acknowledged = chunk[0] === 1;
        return;
      }
      input = Buffer.concat([input, chunk]);
      if (input.length < 4 || input.length < 4 + input.readUInt32LE()) return;
      received = JSON.parse(input.subarray(4).toString());
      replied = true;
      const reply = Buffer.from(
        JSON.stringify({ data: { tracking: true }, error: null }),
      );
      const frame = Buffer.alloc(4 + reply.length);
      frame.writeUInt32LE(reply.length);
      reply.copy(frame, 4);
      socket.write(frame.subarray(0, 2));
      setTimeout(() => socket.write(frame.subarray(2, 9)), 10);
      setTimeout(() => socket.write(frame.subarray(9)), 20);
    });
  });
  await new Promise((resolve) => server.listen(path, resolve));
  try {
    assert.deepEqual(await pipeCall(path, { command: "GetStatus" }), {
      tracking: true,
    });
    await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(received, { command: "GetStatus" });
    assert.equal(acknowledged, true);
  } finally {
    server.close();
  }
});

test("development bridge is absent from browser preview mode", () => {
  const bridge = localCollector(process.cwd(), false);
  assert.equal(bridge.token, "");
  bridge.plugin.configureServer({
    middlewares: {
      use() {
        assert.fail("Preview should have no collector endpoint");
      },
    },
  });
});
