import { strict as assert } from 'assert';
import { findIdeRoot, computeExternalServices } from '../src/externalServices';
import { ProcessInfo, buildProcessIndex } from '../src/processTree';

const P = (pid: number, ppid: number, name: string, commandLine = ''): ProcessInfo => ({
  pid,
  ppid,
  name,
  commandLine,
});

describe('findIdeRoot（沿祖先链找 IDE 主进程）', () => {
  it('返回最顶层的 IDE 进程（终端与扩展宿主共同的父亲）', () => {
    // explorer(1) → CodeBuddy.exe(10) → 终端 cmd(20) → node(21)
    //                         └→ node 扩展宿主(30)
    const procs = [
      P(1, 0, 'explorer.exe'),
      P(10, 1, 'CodeBuddy.exe'),
      P(20, 10, 'cmd.exe'),
      P(21, 20, 'node.exe'),
      P(30, 10, 'node.exe'),
    ];
    assert.equal(findIdeRoot(buildProcessIndex(procs), 21), 10);
    assert.equal(findIdeRoot(buildProcessIndex(procs), 30), 10);
  });

  it('Code.exe / cursor.exe / VSCodium 也识别', () => {
    for (const name of ['Code.exe', 'cursor.exe', 'VSCodium.exe', 'electron.exe']) {
      const procs = [P(1, 0, 'explorer.exe'), P(10, 1, name), P(30, 10, 'node.exe')];
      assert.equal(findIdeRoot(buildProcessIndex(procs), 30), 10, name);
    }
  });

  it('祖先链上无 IDE 进程返回 undefined', () => {
    const procs = [P(1, 0, 'explorer.exe'), P(30, 1, 'node.exe')];
    assert.equal(findIdeRoot(buildProcessIndex(procs), 30), undefined);
  });
});

describe('computeExternalServices（外部服务检测）', () => {
  const IDE = 'CodeBuddy.exe';

  function scene() {
    return [
      P(1, 0, 'explorer.exe'),
      P(10, 1, IDE),
      // 集成终端：cmd → npm(22) → node server(23) 监听 3000
      P(20, 10, 'cmd.exe', 'cmd.exe'),
      P(22, 20, 'node.exe', 'npm run dev'),
      P(23, 22, 'node.exe', 'node server.js'),
      // 扩展宿主(30) → 我们管理的脚本(31) 监听 5173
      P(30, 10, 'node.exe'),
      P(31, 30, 'node.exe', 'node launcher.js'),
      // IDE 自身监听某端口（应排除）
      P(11, 10, IDE, 'CodeBuddy.exe --type=utility'),
      // 系统其他无关 node 监听 9999（不在 IDE 树内，应排除）
      P(40, 1, 'node.exe', 'node other.js'),
    ];
  }

  const sockets = [
    { port: 3000, pid: 23, addresses: ['127.0.0.1'] },
    { port: 5173, pid: 31, addresses: ['0.0.0.0'] },
    { port: 9222, pid: 11, addresses: ['127.0.0.1'] },
    { port: 9999, pid: 40, addresses: ['0.0.0.0'] },
  ];

  it('仅检出终端内服务：排除托管脚本、IDE 自身、IDE 树外进程', () => {
    const result = computeExternalServices({
      procs: scene(),
      sockets,
      extensionHostPid: 30,
      managedRootPids: [31],
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].port, 3000);
    assert.equal(result[0].pid, 23);
    assert.equal(result[0].commandLine, 'node server.js');
  });

  it('无 IDE 根时返回空（防全系统误杀）', () => {
    const procs = scene().filter((p) => p.name !== IDE);
    const result = computeExternalServices({ procs, sockets, extensionHostPid: 30, managedRootPids: [31] });
    assert.deepEqual(result, []);
  });

  it('无托管脚本时终端服务仍能检出', () => {
    const result = computeExternalServices({
      procs: scene(),
      sockets,
      extensionHostPid: 30,
      managedRootPids: [],
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].port, 3000);
  });

  it('监听进程的 name 非传入 procs 时按未知名处理不崩溃', () => {
    const sockets2 = [{ port: 3000, pid: 99999, addresses: ['127.0.0.1'] }];
    const result = computeExternalServices({
      procs: scene(),
      sockets: sockets2,
      extensionHostPid: 30,
      managedRootPids: [],
    });
    assert.deepEqual(result, []);
  });
});
