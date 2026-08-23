import { strict as assert } from 'assert';
import { spawn } from 'child_process';
import * as path from 'path';
import { snapshotProcesses, snapshotPorts } from '../src/sysSnapshot';
import { buildProcessIndex, collectSubtreePids } from '../src/processTree';
import { killProcessTree } from '../src/killTree';
import { extractConflictPort } from '../src/errorParse';

/**
 * 端到端集成测试（真实进程/真实 netstat/真实 PowerShell 快照/真实 taskkill）。
 * 仅在 Windows 执行；其他平台自动跳过。
 */
const isWin = process.platform === 'win32';
const APP_A = path.resolve(__dirname, '..', 'fixtures', 'app-a');
const APP_B = path.resolve(__dirname, '..', 'fixtures', 'app-b');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function portsOfTree(rootPid: number): Promise<{ port: number; pid: number }[]> {
  const [procs, sockets] = await Promise.all([snapshotProcesses(), snapshotPorts()]);
  const subtree = collectSubtreePids(rootPid, buildProcessIndex(procs));
  return sockets.filter((s) => subtree.has(s.pid)).map((s) => ({ port: s.port, pid: s.pid }));
}

function spawnNpm(cwd: string, script: string) {
  const child = spawn('npm.cmd', ['run', '--silent', script], {
    cwd,
    shell: true,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  // 吞掉 spawn 层错误（ENOENT 等），由各测试的断言/清理逻辑处理
  child.on('error', () => {});
  return child;
}

describe('集成：npm 多端口服务追踪（仅 Windows）', function () {
  this.timeout(90000);

  before(function () {
    if (!isWin) {
      this.skip();
    }
  });

  it('npm run dev → 发现两个端口服务 → 单杀一个 → 另一个不受影响 → 清理无孤儿', async function () {
    const child = spawnNpm(APP_A, 'dev');
    const rootPid = child.pid!;
    try {
      // 轮询等待服务出现（npm 冷启动 + PowerShell 快照较慢）
      let found: { port: number; pid: number }[] = [];
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await sleep(2000);
        found = await portsOfTree(rootPid);
        if (found.length >= 2) {
          break;
        }
      }
      assert.equal(
        found.length,
        2,
        `应发现 2 个端口服务（45731/45732），实际: ${JSON.stringify(found)}`
      );
      assert.deepEqual(
        found.map((f) => f.port).sort((a, b) => a - b),
        [45731, 45732]
      );

      // 单杀 45731 的服务进程
      const target = found.find((f) => f.port === 45731)!;
      const killErr = await killProcessTree(target.pid);
      assert.equal(killErr, '', 'taskkill 应成功');

      // 等端口消失，另一端口仍在
      let remaining: { port: number }[] = [];
      const deadline2 = Date.now() + 15000;
      while (Date.now() < deadline2) {
        await sleep(2000);
        remaining = await portsOfTree(rootPid);
        if (!remaining.some((r) => r.port === 45731)) {
          break;
        }
      }
      const ports = remaining.map((r) => r.port);
      assert.ok(!ports.includes(45731), `45731 应已结束，剩余: ${ports}`);
      assert.ok(ports.includes(45732), `45732 应仍在运行，剩余: ${ports}`);
    } finally {
      await killProcessTree(rootPid);
      child.kill();
    }

    // 无孤儿验证：整树杀完后不应残留任何监听进程
    await sleep(2500);
    const orphanPorts = await portsOfTree(rootPid);
    assert.equal(orphanPorts.length, 0, `不应残留孤儿监听进程: ${JSON.stringify(orphanPorts)}`);
  });

  it('killProcessTree 对不存在的 PID 视为成功（重复点击停止不报错）', async function () {
    const bogus = 999999; // 假设系统没有这个 PID
    const err = await killProcessTree(bogus);
    assert.equal(err, '', `杀不存在进程应返回成功，实际: ${err}`);
  });

  it('单服务重启：按快照命令行拉起 → 归属并集仍含该端口 → 停止后无孤儿', async function () {
    const child = spawnNpm(APP_A, 'dev');
    const rootPid = child.pid!;
    let adopted: number | undefined; // 模拟 runner.respawnService 拉起的代管进程
    try {
      // 等两个服务出现
      let found: { port: number; pid: number }[] = [];
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await sleep(2000);
        found = await portsOfTree(rootPid);
        if (found.length >= 2) {
          break;
        }
      }
      assert.equal(found.length, 2, `应发现 2 个服务，实际: ${JSON.stringify(found)}`);

      // 从进程快照抓 45732 服务的完整命令行（respawn 的凭据）
      const procs = await snapshotProcesses();
      const target = found.find((f) => f.port === 45732)!;
      const cmdline = procs.find((p) => p.pid === target.pid)?.cmdline;
      assert.ok(cmdline, `应能抓到 45732 服务的命令行（PID ${target.pid}）`);
      assert.ok(cmdline!.includes('server-b'), `命令行应含 server-b，实际: ${cmdline}`);

      // 杀掉该服务，另一服务不动
      assert.equal(await killProcessTree(target.pid), '');
      // 按命令行在项目目录重新拉起（等价 runner.respawnService 的 spawn 参数）
      const respawned = spawn(cmdline!, {
        cwd: APP_A,
        shell: true,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      });
      respawned.on('error', () => {});
      adopted = respawned.pid;

      // 等端口以新 PID 回来
      const deadline2 = Date.now() + 15000;
      let ownerPid: number | undefined;
      while (Date.now() < deadline2) {
        await sleep(2000);
        const sockets = await snapshotPorts();
        ownerPid = sockets.find((s) => s.port === 45732)?.pid;
        if (ownerPid !== undefined) {
          break;
        }
      }
      assert.ok(ownerPid, '重启后 45732 应回到监听状态');
      assert.notEqual(ownerPid, target.pid, '新监听者应是重新拉起的进程');

      // 归属判定 = 子树 ∪ adopted 子树（serviceMonitor tick 的同款逻辑：
      // shell:true 拉起时 PID 是 shell 包装层，真正监听者是其子进程）
      const [procs2, sockets2] = await Promise.all([snapshotProcesses(), snapshotPorts()]);
      const index2 = buildProcessIndex(procs2);
      const subtree = collectSubtreePids(rootPid, index2);
      for (const a of collectSubtreePids(adopted!, index2)) {
        subtree.add(a);
      }
      subtree.add(adopted!);
      const owned = sockets2.filter((s) => subtree.has(s.pid)).map((s) => s.port).sort((a, b) => a - b);
      assert.deepEqual(owned, [45731, 45732], '并集归属应同时含未动服务与重启服务');
    } finally {
      await killProcessTree(rootPid);
      if (adopted !== undefined) {
        await killProcessTree(adopted); // runner.stop 的同款清理
      }
      child.kill();
    }

    // 无孤儿：树 + 代管全杀后不应残留监听
    await sleep(2500);
    const procs3 = await snapshotProcesses();
    const sockets3 = await snapshotPorts();
    const leftovers = sockets3.filter((s) => s.port === 45731 || s.port === 45732);
    assert.equal(
      leftovers.length,
      0,
      `不应残留孤儿监听: ${JSON.stringify(leftovers)}（进程数 ${procs3.length}）`
    );
  });

  it('全部服务被替换为代管进程后：脚本自然退出、代管服务存活、清理无孤儿', async function () {
    const child = spawnNpm(APP_A, 'dev');
    const rootPid = child.pid!;
    const adopted: number[] = [];
    let rootCode: number | null | undefined;
    child.on('close', (c) => {
      rootCode = c;
    });
    try {
      // 等两个服务出现
      let found: { port: number; pid: number }[] = [];
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await sleep(2000);
        found = await portsOfTree(rootPid);
        if (found.length >= 2) {
          break;
        }
      }
      assert.equal(found.length, 2, `应发现 2 个服务，实际: ${JSON.stringify(found)}`);

      // 逐个"重启"：杀原进程 → 按快照命令行拉起（runner.respawnService 同款参数）
      const procs = await snapshotProcesses();
      for (const port of [45731, 45732]) {
        const target = found.find((f) => f.port === port)!;
        const cmdline = procs.find((p) => p.pid === target.pid)?.cmdline;
        assert.ok(cmdline, `应能抓到 :${port} 服务的命令行（PID ${target.pid}）`);
        assert.equal(await killProcessTree(target.pid), '');
        const r = spawn(cmdline!, {
          cwd: APP_A,
          shell: true,
          windowsHide: true,
          env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        });
        r.on('error', () => {});
        adopted.push(r.pid!);
      }

      // launcher 类脚本（靠等待子进程存活）在子进程全被替换后会自然退出——
      // 这是脚本自身的语义；扩展应让代管服务继续存活
      const deadline2 = Date.now() + 15000;
      while (Date.now() < deadline2 && rootCode === undefined) {
        await sleep(1000);
      }
      assert.notEqual(rootCode, undefined, '原脚本进程应已自然退出（事件循环清空）');

      // 代管服务仍在监听（扩展"代管"状态的核心承诺）
      await sleep(2000);
      const sockets = await snapshotPorts();
      assert.ok(
        sockets.some((s) => s.port === 45731),
        '代管 server-a 应继续监听 45731'
      );
      assert.ok(
        sockets.some((s) => s.port === 45732),
        '代管 server-b 应继续监听 45732'
      );
    } finally {
      // runner.stop 的同款清理：树 + 代管全杀
      await killProcessTree(rootPid);
      for (const pid of adopted) {
        await killProcessTree(pid);
      }
      child.kill();
    }

    await sleep(2500);
    const leftovers = (await snapshotPorts()).filter((s) => s.port === 45731 || s.port === 45732);
    assert.equal(leftovers.length, 0, `不应残留孤儿监听: ${JSON.stringify(leftovers)}`);
  });

  it('固定端口被外部占用时，第二个实例报 EADDRINUSE 且可提取端口', async function () {
    const first = spawnNpm(APP_B, 'start');
    try {
      // 等第一个实例监听 45800
      const deadline = Date.now() + 20000;
      let firstPorts: number[] = [];
      while (Date.now() < deadline) {
        await sleep(2000);
        firstPorts = (await portsOfTree(first.pid!)).map((p) => p.port);
        if (firstPorts.includes(45800)) {
          break;
        }
      }
      assert.ok(firstPorts.includes(45800), '第一个实例应监听 45800');

      // 第二个实例抢同端口：收集其输出与退出码
      const second = spawnNpm(APP_B, 'start');
      let output = '';
      let exitCode: number | null = null;
      second.stdout?.on('data', (d: Buffer) => (output += d.toString('utf8')));
      second.stderr?.on('data', (d: Buffer) => (output += d.toString('utf8')));
      const closed = new Promise<void>((resolve) => {
        second.on('close', (code) => {
          exitCode = code;
          resolve();
        });
      });
      await Promise.race([closed, sleep(25000)]);

      assert.notEqual(exitCode, 0, '第二个实例应非零退出');
      const port = extractConflictPort(output);
      assert.equal(port, 45800, `应从输出提取冲突端口 45800，输出: ${output.slice(-500)}`);

      // 端口快照中该端口仍被第一个实例占用
      const sockets = await snapshotPorts();
      const owner = sockets.find((s) => s.port === 45800);
      assert.ok(owner, '快照应能看到 45800 的占用者');
      const firstTree = await portsOfTree(first.pid!);
      assert.ok(
        firstTree.some((p) => p.pid === owner!.pid),
        '占用者应属于第一个实例的进程树'
      );
    } finally {
      await killProcessTree(first.pid!);
    }
  });
});
