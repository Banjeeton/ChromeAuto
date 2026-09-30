import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { resolve } from "node:path";

import { generate } from "selfsigned";

const host = "127.0.0.1";
const httpPort = 4173;
const httpsPort = 4174;
const fixturePath = resolve("dist/playwright-crx-fixture.html");

const fixture = await readFile(fixturePath);
const certificate = await generate(
  [{ name: "commonName", value: "localhost" }],
  {
    algorithm: "sha256",
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" }
        ]
      }
    ]
  }
);

const handler = (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ready");
    return;
  }

  if (
    request.url === "/playwright-crx-fixture.html" ||
    request.url === "/"
  ) {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8"
    });
    response.end(fixture);
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("Not found");
};

const httpServer = createHttpServer(handler);
const httpsServer = createHttpsServer(
  { cert: certificate.cert, key: certificate.private },
  handler
);

await Promise.all([
  listen(httpServer, httpPort),
  listen(httpsServer, httpsPort)
]);

console.log(
  `E2E fixtures ready at http://${host}:${httpPort} and https://${host}:${httpsPort}`
);

const shutdown = () => {
  httpServer.close();
  httpsServer.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function listen(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolveListen);
  });
}
