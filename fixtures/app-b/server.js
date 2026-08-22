const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('app-b\n');
});
server.listen(45800, () => {
  console.log('[app-b] listening on http://127.0.0.1:45800');
});
