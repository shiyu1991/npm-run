import { strict as assert } from 'assert';
import { extractConflictPort } from '../src/errorParse';

describe('extractConflictPort（EADDRINUSE 端口提取）', () => {
  it('Node 标准 EADDRINUSE 报错提取端口', () => {
    const out = 'Error: listen EADDRINUSE: address already in use 0.0.0.0:3000';
    assert.equal(extractConflictPort(out), 3000);
  });

  it('Node IPv6 :::8080 格式', () => {
    const out = 'Error: listen EADDRINUSE: address already in use :::8080';
    assert.equal(extractConflictPort(out), 8080);
  });

  it('Node IPv6 [::]:3000 格式', () => {
    const out = 'Error: listen EADDRINUSE: address already in use [::]:3000';
    assert.equal(extractConflictPort(out), 3000);
  });

  it('带上下文日志中的 EADDRINUSE 也能提取', () => {
    const out = [
      'node:events:496',
      '  throw er; // Unhandled \'error\' event',
      'Error: listen EADDRINUSE: address already in use 127.0.0.1:5173',
      '    at Server.setupListenHandle [as listen] (...)',
    ].join('\n');
    assert.equal(extractConflictPort(out), 5173);
  });

  it('正常启动日志返回 undefined', () => {
    assert.equal(extractConflictPort('VITE ready in 321 ms\nLocal: http://localhost:5173/'), undefined);
  });

  it('空字符串返回 undefined', () => {
    assert.equal(extractConflictPort(''), undefined);
  });
});
