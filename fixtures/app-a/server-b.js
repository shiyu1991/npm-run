const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('server-b\n');
});
server.listen(45732, () => {
  console.log('[server-b] listening on http://127.0.0.1:45732');
});
