const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('server-a\n');
});
server.listen(45731, () => {
  console.log('[server-a] listening on http://127.0.0.1:45731');
});
