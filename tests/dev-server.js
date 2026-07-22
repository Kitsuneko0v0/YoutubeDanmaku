'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const requestedPath = path.resolve(root, `.${pathname}`);
  if (!requestedPath.startsWith(root + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(requestedPath, (statError, stat) => {
    const filePath = !statError && stat.isDirectory()
      ? path.join(requestedPath, 'index.html')
      : requestedPath;
    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      response.end(data);
    });
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`UI fixture: http://127.0.0.1:${port}/tests/ui-fixture.html`);
});
