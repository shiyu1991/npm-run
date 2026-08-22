import { strict as assert } from 'assert';
import {
  parseNetstatWindows,
  parseLsof,
  parseSs,
  ListeningSocket,
} from '../src/portScanner';

describe('parseNetstatWindows（Windows netstat -ano）', () => {
  it('解析 LISTENING 的 TCP 行提取 address/port/pid', () => {
    const out = [
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234',
      '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       5678',
    ].join('\r\n');
    const sockets = parseNetstatWindows(out);
    assert.equal(sockets.length, 2);
    assert.deepEqual(sockets[0], { port: 135, pid: 1234, addresses: ['0.0.0.0'] });
    assert.deepEqual(sockets[1], { port: 5173, pid: 5678, addresses: ['127.0.0.1'] });
  });

  it('解析 IPv6 [::1]:5173 格式', () => {
    const out = '  TCP    [::1]:5173             [::]:0                 LISTENING       5678';
    const sockets = parseNetstatWindows(out);
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].port, 5173);
    assert.deepEqual(sockets[0].addresses, ['[::1]']);
    assert.equal(sockets[0].pid, 5678);
  });

  it('忽略非 LISTENING 状态与 UDP 行', () => {
    const out = [
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    192.168.1.5:49192      10.1.1.1:443           ESTABLISHED     9012',
      '  UDP    127.0.0.1:5353         *:*                                    9013',
    ].join('\r\n');
    assert.deepEqual(parseNetstatWindows(out), []);
  });

  it('同端口的 IPv4 与 IPv6 两条记录合并为一个条目', () => {
    const out = [
      '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       5678',
      '  TCP    [::]:5173              [::]:0                 LISTENING       5678',
    ].join('\r\n');
    const sockets = parseNetstatWindows(out);
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].port, 5173);
    assert.equal(sockets[0].pid, 5678);
    assert.equal(sockets[0].addresses.length, 2);
  });
});

describe('parseLsof（macOS lsof -i -P -n）', () => {
  it('解析 (LISTEN) 行提取 port/pid，*: 通配地址', () => {
    const out = [
      'COMMAND   PID  USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME',
      'node    5678  user   23u  IPv4  0x1234      0t0  TCP *:5173 (LISTEN)',
      'node    5678  user   24u  IPv6  0x1235      0t0  TCP localhost:3000 (LISTEN)',
    ].join('\n');
    const sockets = parseLsof(out);
    assert.equal(sockets.length, 2);
    assert.deepEqual(sockets[0], { port: 5173, pid: 5678, addresses: ['*'] });
    assert.deepEqual(sockets[1], { port: 3000, pid: 5678, addresses: ['localhost'] });
  });

  it('忽略已建立连接（非 LISTEN）行', () => {
    const out = 'node    5678  user   26u  IPv4  0x1237      0t0  TCP localhost:5173->localhost:52000 (ESTABLISHED)';
    assert.deepEqual(parseLsof(out), []);
  });
});

describe('parseSs（Linux ss -tlnp）', () => {
  it('解析 LISTEN 行提取 address/port/pid', () => {
    const out = [
      'State   Recv-Q  Send-Q   Local Address:Port    Peer Address:Port  Process',
      'LISTEN  0       128          0.0.0.0:5173         0.0.0.0:*       users:(("node",pid=5678,fd=23))',
      'LISTEN  0       511          [::]:5173            [::]:*          users:(("node",pid=5678,fd=24))',
    ].join('\n');
    const sockets = parseSs(out);
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].port, 5173);
    assert.equal(sockets[0].pid, 5678);
    assert.equal(sockets[0].addresses.length, 2);
  });

  it('解析 127.0.0.1 绑定与不同 pid', () => {
    const out =
      'LISTEN  0       128      127.0.0.1:3000           0.0.0.0:*       users:(("vite",pid=9012,fd=24))';
    const sockets: ListeningSocket[] = parseSs(out);
    assert.equal(sockets.length, 1);
    assert.deepEqual(sockets[0], { port: 3000, pid: 9012, addresses: ['127.0.0.1'] });
  });
});
