// 模拟 concurrently：一个 node 父进程同时管理多个服务子进程
const { spawn } = require('child_process');

const a = spawn(process.execPath, ['server-a.js'], { stdio: 'inherit' });
const b = spawn(process.execPath, ['server-b.js'], { stdio: 'inherit' });

function shutdown() {
  a.kill();
  b.kill();
}
process.on('exit', shutdown);
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});
