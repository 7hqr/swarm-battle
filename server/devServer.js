import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startSignalingServer } from "./signalingServer.js";

const DEFAULT_GAME_PORT = 4173;
const DEFAULT_SIGNAL_PORT = 3012;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const gamePort = Number.parseInt(process.env.SWARMBATTLE_GAME_PORT ?? `${DEFAULT_GAME_PORT}`, 10);
const signalPort = Number.parseInt(process.env.SWARMBATTLE_SIGNAL_PORT ?? `${DEFAULT_SIGNAL_PORT}`, 10);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav"
};

const gameServer = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${gamePort}`}`);
    const relativePath = requestUrl.pathname === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname.slice(1));
    const filePath = path.resolve(repoRoot, relativePath);

    if (!filePath.startsWith(repoRoot + path.sep) && filePath !== path.join(repoRoot, "index.html")) {
      response.writeHead(403);
      response.end();
      return;
    }

    const fileContents = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
    });
    response.end(fileContents);
  } catch (error) {
    if (error?.code === "ENOENT") {
      response.writeHead(404);
      response.end();
      return;
    }

    response.writeHead(500);
    response.end();
  }
});

await new Promise((resolve, reject) => {
  const handleGameServerError = (error) => {
    reject(new Error(`Cannot bind game server to http://localhost:${gamePort}: ${error.code ?? error.message}`));
  };

  gameServer.once("error", handleGameServerError);
  gameServer.listen(gamePort, () => {
    gameServer.off("error", handleGameServerError);
    resolve();
  });
});

const signalingServer = startSignalingServer({ port: signalPort });

await new Promise((resolve, reject) => {
  const handleSignalServerError = (error) => {
    reject(new Error(`Cannot bind signaling server to ws://localhost:${signalPort}: ${error.code ?? error.message}`));
  };

  signalingServer.once("error", handleSignalServerError);
  signalingServer.once("listening", () => {
    signalingServer.off("error", handleSignalServerError);
    resolve();
  });
});

console.log(`SwarmBattle game server listening on http://localhost:${gamePort}`);
console.log(`SwarmBattle PvP signaling server available at ws://localhost:${signalPort}`);
console.log("Press Ctrl+C to stop both servers.");

let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  await Promise.all([
    new Promise((resolve) => {
      gameServer.close(() => resolve());
    }),
    new Promise((resolve, reject) => {
      signalingServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    })
  ]);

  process.exit(exitCode);
}

process.on("SIGINT", () => {
  shutdown(0).catch((error) => {
    console.error(error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown(0).catch((error) => {
    console.error(error);
    process.exit(1);
  });
});

process.on("uncaughtException", (error) => {
  console.error(error);
  shutdown(1).catch(() => {
    process.exit(1);
  });
});

process.on("unhandledRejection", (error) => {
  console.error(error);
  shutdown(1).catch(() => {
    process.exit(1);
  });
});
