import { strict as assert } from 'assert';
import { ProcessInfo } from '../src/processTree';
import { ListeningSocket } from '../src/portScanner';
import { matchExternalScripts, ProjectRef } from '../src/externalDetect';

const P = (pid: number, ppid: number, name: string, cmdline?: string): ProcessInfo => ({
  pid,
  ppid,
  name,
  cmdline,
});
const SOCK = (port: number, pid: number, addresses: string[] = ['0.0.0.0']): ListeningSocket => ({
  port,
  pid,
  addresses,
});
const PROJ = (dir: string, ...scripts: string[]): ProjectRef => ({ dir, scripts: new Set(scripts) });

/** 典型 Windows 外部 npm run dev 四层链（终端包装 → npm → cmd → 执行层） */
function externalNpmChain(root: number, projDir: string, script: string): ProcessInfo[] {
  const norm = projDir.replace(/\//g, '\\');
  return [
    P(root, 4, 'powershell.exe', `powershell.exe -Command Set-Location ${norm}; npm run ${script}`),
    P(root + 1, root, 'node.exe',
      `"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run ${script}`),
    P(root + 2, root + 1, 'cmd.exe', `"C:\\Windows\\system32\\cmd.exe" /d /s /c "next dev"`),
    P(root + 3, root + 2, 'node.exe',
      `"C:\\Program Files\\nodejs\\node.exe" ${norm}\\node_modules\\next\\dist\\bin\\next dev`),
  ];
}

describe('matchExternalScripts', () => {
  it('A 级：执行层 node_modules 路径锚定项目 → 精确命中，链根为最顶层 run 层', () => {
    const procs = [
      P(1, 0, 'System'),
      ...externalNpmChain(1000, 'd:\\proj-a', 'dev'),
    ];
    const projects = [PROJ('d:\\proj-a', 'dev', 'build')];
    const hits = matchExternalScripts(procs, [], projects, new Set());
    assert.equal(hits.size, 1);
    const hit = hits.get('d:\\proj-a|dev');
    assert.ok(hit);
    assert.equal(hit.script, 'dev');
    assert.equal(hit.runPid, 1000, '链根应为终端包装层（最顶层 run 层）');
    assert.ok(hit.pids.includes(1003), '证据应含执行层 pid');
    assert.ok(hit.cmdline, '应携带证据命令行');
  });

  it('路径大小写与斜杠方向规范化后仍命中', () => {
    const procs = [
      P(2001, 2000, 'node.exe',
        '"C:\\Program Files\\nodejs\\node.exe" D:/PROJ-A/node_modules/vite/bin/vite.js'),
      P(2000, 1, 'node.exe',
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev'),
    ];
    const projects = [PROJ('d:\\proj-a', 'dev')];
    const hits = matchExternalScripts(procs, [], projects, new Set());
    assert.ok(hits.get('d:\\proj-a|dev'));
  });

  it('前缀相近的项目不误配（my-app vs my-app-2）', () => {
    const procs = externalNpmChain(3000, 'd:\\ws\\my-app-2', 'dev');
    const projects = [PROJ('d:\\ws\\my-app', 'dev'), PROJ('d:\\ws\\my-app-2', 'dev')];
    const hits = matchExternalScripts(procs, [], projects, new Set());
    assert.equal(hits.size, 1);
    assert.ok(hits.get('d:\\ws\\my-app-2|dev'));
    assert.ok(!hits.get('d:\\ws\\my-app|dev'));
  });

  it('script 名完整 token 匹配（dev 不误配 dev:watch）', () => {
    const procs = externalNpmChain(4000, 'd:\\proj-a', 'dev:watch');
    // 项目只有 dev，没有 dev:watch → A 级不命中；B 级候选 script=dev:watch 也无声明 → 不命中
    const projects = [PROJ('d:\\proj-a', 'dev')];
    assert.equal(matchExternalScripts(procs, [], projects, new Set()).size, 0);
    // 项目有 dev:watch → 命中 dev:watch
    const projects2 = [PROJ('d:\\proj-a', 'dev', 'dev:watch')];
    const hits = matchExternalScripts(procs, [], projects2, new Set());
    assert.ok(hits.get('d:\\proj-a|dev:watch'));
  });

  it('排除集内的进程不产生命中', () => {
    const procs = externalNpmChain(5000, 'd:\\proj-a', 'dev');
    const projects = [PROJ('d:\\proj-a', 'dev')];
    // 模拟扩展自身实例子树（整链被排除）
    const exclude = new Set([5000, 5001, 5002, 5003]);
    assert.equal(matchExternalScripts(procs, [], projects, exclude).size, 0);
    // 链上任一进程被排除（如执行层）即整链跳过
    const exclude2 = new Set([5003]);
    assert.equal(matchExternalScripts(procs, [], projects, exclude2).size, 0);
  });

  it('命中链子树内的监听端口归入 hit.ports', () => {
    const procs = [
      ...externalNpmChain(6000, 'd:\\proj-a', 'dev'),
      // next start-server worker：监听 3000
      P(6004, 6003, 'node.exe',
        '"C:\\Program Files\\nodejs\\node.exe" d:\\proj-a\\node_modules\\next\\dist\\server\\lib\\start-server.js'),
      // 无关进程监听另一端口
      P(9000, 1, 'node.exe', 'node other.js'),
    ];
    const sockets = [SOCK(3000, 6004), SOCK(9999, 9000)];
    const projects = [PROJ('d:\\proj-a', 'dev')];
    const hits = matchExternalScripts(procs, sockets, projects, new Set());
    const hit = hits.get('d:\\proj-a|dev');
    assert.ok(hit);
    assert.deepEqual(hit.ports.map((p) => p.port), [3000]);
    assert.equal(hit.ports[0].pid, 6004);
  });

  it('C 级：链内 node_modules 路径指向工作区外项目 → 不显示（IDEA 场景回归）', () => {
    // 仿真实诊断数据：next dev 链，执行层路径指向工作区外的项目
    const procs = [
      P(7100, 1, 'node.exe',
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev'),
      P(7101, 7100, 'cmd.exe', 'C:\\Windows\\system32\\cmd.exe /d /s /c next dev'),
      P(7102, 7101, 'node.exe',
        '"node" "D:\\workspace\\task-forge\\taskforge-web\\node_modules\\.bin\\\\..\\@nuxt\\cli\\bin\\nuxi.mjs" dev'),
    ];
    // 工作区内 app-a 也声明了 dev —— 也不挂（C 级证据确定链属于工作区外）
    const projects = [PROJ('d:\\ws\\app-a', 'dev')];
    assert.equal(matchExternalScripts(procs, [], projects, new Set()).size, 0);
  });

  it('工作区外项目跑的脚本不误配到工作区项目（用户场景回归）', () => {
    const procs = externalNpmChain(7000, 'd:\\完全无关的项目', 'dev');
    const projects = [PROJ('d:\\workspace\\app-a', 'dev')];
    assert.equal(matchExternalScripts(procs, [], projects, new Set()).size, 0);
  });

  it('B 级：链内无 node_modules 路径证据（node launcher.js 类）+ 唯一候选项目 → 命中', () => {
    // 仿真实诊断：app-a 类项目，脚本命令为相对路径 node 命令，链上无任何项目路径
    const procs = [
      P(9100, 1, 'powershell.exe', 'powershell.exe -Command Set-Location d:\\ws\\app-a; npm run dev'),
      P(9101, 9100, 'node.exe',
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev'),
      P(9102, 9101, 'cmd.exe', 'C:\\Windows\\system32\\cmd.exe /d /s /c node launcher.js'),
      P(9103, 9102, 'node.exe', 'node  launcher.js'),
    ];
    const projects = [PROJ('d:\\ws\\app-a', 'dev', 'single'), PROJ('d:\\ws\\other', 'build')];
    const hits = matchExternalScripts(procs, [], projects, new Set());
    const hit = hits.get('d:\\ws\\app-a|dev');
    assert.ok(hit, '唯一声明 dev 的项目应命中');
    assert.equal(hit.runPid, 9100);
  });

  it('B 级：多候选项目（多项目同名脚本、链无路径证据）→ 不命中', () => {
    const procs = [
      P(9200, 1, 'node.exe',
        '"node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev'),
      P(9201, 9200, 'cmd.exe', 'cmd.exe /d /s /c node server.js'),
      P(9202, 9201, 'node.exe', 'node  server.js'),
    ];
    const projects = [PROJ('d:\\proj-a', 'dev'), PROJ('d:\\proj-b', 'dev')];
    assert.equal(matchExternalScripts(procs, [], projects, new Set()).size, 0);
  });

  it('B 级命中链的子树端口也归入 hit.ports', () => {
    const procs = [
      P(9300, 1, 'node.exe',
        '"node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev'),
      P(9301, 9300, 'node.exe', 'node  server.js'),
    ];
    const sockets = [SOCK(45731, 9301)];
    const projects = [PROJ('d:\\ws\\app-a', 'dev')];
    const hits = matchExternalScripts(procs, sockets, projects, new Set());
    assert.deepEqual(hits.get('d:\\ws\\app-a|dev')!.ports.map((p) => p.port), [45731]);
  });

  it('pnpm 简写（pnpm.cjs dev，无 run 字样）可命中', () => {
    const procs = [
      P(8100, 1, 'node.exe',
        '"node.exe" "C:\\Users\\u\\AppData\\Local\\pnpm\\pnpm.cjs" dev'),
      P(8101, 8100, 'node.exe',
        '"node.exe" d:\\proj-a\\node_modules\\.bin\\..\\vite\\bin\\vite.js'),
    ];
    const projects = [PROJ('d:\\proj-a', 'dev')];
    const hits = matchExternalScripts(procs, [], projects, new Set());
    assert.ok(hits.get('d:\\proj-a|dev'), 'pnpm 简写链应命中');
  });

  it('yarn 简写（yarn dev）可命中', () => {
    const procs = [
      P(8200, 1, 'node.exe',
        '"node.exe" "C:\\Users\\u\\AppData\\Yarn\\bin\\yarn.js" dev'),
      P(8201, 8200, 'node.exe',
        '"node.exe" d:\\proj-a\\node_modules\\vite\\bin\\vite.js'),
    ];
    const projects = [PROJ('d:\\proj-a', 'dev')];
    const hits = matchExternalScripts(procs, [], projects, new Set());
    assert.ok(hits.get('d:\\proj-a|dev'), 'yarn 简写链（含执行层路径）应命中');
  });

  it('pnpm/yarn 内置命令（install 等）不当作 script', () => {
    const procs = [
      P(8300, 1, 'node.exe', '"node.exe" "C:\\Users\\u\\AppData\\Local\\pnpm\\pnpm.cjs" install'),
    ];
    const projects = [PROJ('d:\\proj-a', 'install', 'dev')];
    assert.equal(matchExternalScripts(procs, [], projects, new Set()).size, 0);
  });

  it('script 名不在任何项目 → 不命中', () => {
    const procs = externalNpmChain(8400, 'd:\\proj-a', 'nope');
    const projects = [PROJ('d:\\proj-a', 'dev')];
    assert.equal(matchExternalScripts(procs, [], projects, new Set()).size, 0);
  });

  it('同一脚本多条执行进程去重为单 hit，pids 合并', () => {
    const procs = [
      P(8500, 1, 'node.exe',
        '"node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev'),
      P(8501, 8500, 'node.exe', '"node.exe" d:\\proj-a\\node_modules\\vite\\bin\\vite.js'),
      P(8502, 8500, 'node.exe', '"node.exe" d:\\proj-a\\node_modules\\tailwindcss\\lib\\cli.js'),
    ];
    const projects = [PROJ('d:\\proj-a', 'dev')];
    const hits = matchExternalScripts(procs, [], projects, new Set());
    assert.equal(hits.size, 1);
    const hit = hits.get('d:\\proj-a|dev')!;
    assert.ok(hit.pids.includes(8501));
    assert.ok(hit.pids.includes(8502));
  });

  it('cmdline 缺省的进程跳过不报错', () => {
    const procs = [P(8600, 1, 'node.exe'), P(8601, 8600, 'node.exe')];
    const projects = [PROJ('d:\\proj-a', 'dev')];
    assert.equal(matchExternalScripts(procs, [], projects, new Set()).size, 0);
  });

  it('链根自身 cmdline 的全局 npm 路径不算项目证据（不触发 C 级误排除）', () => {
    // npm 实体层是链根（无终端包装层），其 cmdline 含全局 npm-cli.js 路径，
    // 子进程无任何 node_modules —— 应走 B 级而非被 C 级排除
    const procs = [
      P(8700, 1, 'node.exe',
        '"node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev'),
      P(8701, 8700, 'cmd.exe', 'cmd.exe /d /s /c node server.js'),
      P(8702, 8701, 'node.exe', 'node  server.js'),
    ];
    const projects = [PROJ('d:\\proj-a', 'dev')];
    assert.ok(matchExternalScripts(procs, [], projects, new Set()).get('d:\\proj-a|dev'));
  });
});
