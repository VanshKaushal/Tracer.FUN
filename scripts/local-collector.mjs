import net from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const limit = 16 * 1024 * 1024;
export function pipeCall(path, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    let buffer = Buffer.alloc(0);
    let finished = false;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(12000, () =>
      fail(new Error("Collector response timed out.")),
    );
    socket.on("error", fail);
    socket.on("close", () => {
      if (!finished) fail(new Error("Collector disconnected before replying."));
    });
    socket.on("connect", () => {
      const body = Buffer.from(JSON.stringify(request));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const size = buffer.readUInt32LE(0);
      if (size > limit)
        return fail(new Error("Collector reply exceeds 16 MB."));
      if (buffer.length < size + 4) return;
      try {
        const response = JSON.parse(buffer.subarray(4, size + 4).toString());
        finished = true;
        socket.end(Buffer.from([1]));
        if (response.error) reject(new Error(response.error));
        else resolve(response.data);
      } catch (error) {
        fail(error);
      }
    });
  });
}

export function localCollector(
  root,
  enabled = process.platform === "win32" &&
    process.env.TRACE_BROWSER_PREVIEW !== "1",
) {
  const token = enabled ? randomBytes(32).toString("hex") : "";
  let pipe;
  let queue = Promise.resolve();
  const serial = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const pipePath = () => {
    if (!pipe) {
      const sid = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
        ],
        { encoding: "utf8", windowsHide: true },
      ).trim();
      if (!/^S-1-\d+(?:-\d+)+$/.test(sid))
        throw new Error("Cannot identify the current Windows user.");
      pipe = `\\\\.\\pipe\\Trace-${sid}`;
    }
    return pipe;
  };
  const connect = async () => {
    const path = pipePath();
    try {
      await pipeCall(path, { command: "GetStatus" });
      return;
    } catch {}
    const exe = [
      join(root, "dist", "trace-agent.exe"),
      join(root, "target", "debug", "trace-agent.exe"),
    ].find(existsSync);
    if (!exe)
      throw new Error(
        "Collector executable missing. Run npm run sidecar or build the Windows app first.",
      );
    const child = spawn(exe, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    let failure;
    child.on("error", (error) => {
      failure = error;
    });
    child.on("exit", (code) => {
      if (code)
        failure = new Error(
          `Collector exited with code ${code}. Check %LOCALAPPDATA%\\Trace\\trace.log.`,
        );
    });
    child.unref();
    for (let attempt = 0; attempt < 40; attempt++) {
      if (failure) throw failure;
      try {
        await pipeCall(path, { command: "GetStatus" });
        return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      "Collector did not become ready. Check %LOCALAPPDATA%\\Trace\\trace.log and click Reconnect.",
    );
  };
  return {
    token,
    plugin: {
      name: "trace-local-collector",
      apply: "serve",
      configureServer(server) {
        if (!enabled) return;
        const ready = serial(connect);
        ready.catch((error) =>
          server.config.logger.error(`[Trace] ${error.message}`),
        );
        server.middlewares.use("/__trace", async (req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          const origin = req.headers.origin;
          const expected = `http://${req.headers.host}`;
          if (
            req.method !== "POST" ||
            req.headers["x-trace-token"] !== token ||
            origin !== expected ||
            !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? "")
          ) {
            res.statusCode = 403;
            res.end(
              JSON.stringify({ error: "Local collector access denied." }),
            );
            return;
          }
          try {
            let body = "";
            for await (const chunk of req) {
              body += chunk;
              if (Buffer.byteLength(body) > 65536)
                throw new Error("Request too large.");
            }
            const request = JSON.parse(body);
            const data = await serial(async () => {
              if (request.command === "Reconnect") {
                await connect();
                return null;
              }
              return pipeCall(pipePath(), request);
            });
            res.end(JSON.stringify({ data }));
          } catch (error) {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: error.message }));
          }
        });
      },
    },
  };
}
