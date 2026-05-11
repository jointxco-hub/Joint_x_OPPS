const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 5185);
const root = path.resolve(__dirname, "..", "dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

http.createServer((request, response) => {
  const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
  let filePath = path.join(root, requestPath === "/" ? "index.html" : requestPath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || stat.isDirectory()) {
      filePath = path.join(root, "index.html");
    }

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
      response.end(data);
    });
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Ops preview running at http://127.0.0.1:${port}`);
});
