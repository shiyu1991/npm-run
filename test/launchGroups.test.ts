import { strict as assert } from 'assert';
import * as path from 'path';
import {
  resolveGroups,
  resolveRef,
  makeRef,
  relativeDirOf,
  GroupProjectLike,
} from '../src/launchGroups';

/** raw 字段模拟 extension 侧携带的原始 NpmProject 引用（解析命中后应透传） */
const PROJ = (name: string, relativeDir: string, ...scripts: string[]): GroupProjectLike & { raw: string } => ({
  name,
  relativeDir,
  scripts: new Set(scripts),
  raw: `<${relativeDir}|${name}>`,
});

const MONO = [
  PROJ('web-app', 'apps/web', 'dev', 'build', 'dev:watch'),
  PROJ('admin-app', 'apps/admin', 'dev', 'build'),
  PROJ('core', 'packages/core', 'dev', 'build'),
  PROJ('root-suite', '.', 'dev'),
];

describe('resolveRef', () => {
  it('相对路径（posix）精确匹配项目', () => {
    const m = resolveRef('packages/core:dev', MONO);
    assert.equal(m.project, MONO[2]);
    assert.equal(m.script, 'dev');
  });

  it('Windows 反斜杠与大小写差异仍命中（路径规范化）', () => {
    const m = resolveRef('Packages\\Core:dev', MONO);
    assert.equal(m.project, MONO[2]);
    assert.equal(m.script, 'dev');
  });

  it('name 兜底：根项目（relativeDir "."）按 package.json name 唯一命中', () => {
    const m = resolveRef('root-suite:dev', MONO);
    assert.equal(m.project, MONO[3]);
    assert.equal(m.script, 'dev');
  });

  it('name 重名（多个项目同名）宁可不解析', () => {
    const dup = [PROJ('same', 'a', 'dev'), PROJ('same', 'b', 'dev'), ...MONO];
    const m = resolveRef('same:dev', dup);
    assert.equal(m.project, undefined);
    assert.equal(m.script, undefined);
  });

  it('分隔符取第一个冒号：脚本名可含冒号（dev:watch）', () => {
    const m = resolveRef('apps/web:dev:watch', MONO);
    assert.equal(m.project, MONO[0]);
    assert.equal(m.script, 'dev:watch');
  });

  it('无冒号 / 冒号位于开头 → 未解析', () => {
    assert.equal(resolveRef('webdev', MONO).project, undefined);
    assert.equal(resolveRef(':dev', MONO).project, undefined);
  });

  it('项目命中但脚本未声明 → 未解析（不返回半解析结果）', () => {
    const m = resolveRef('packages/core:nosuch', MONO);
    assert.equal(m.project, undefined);
    assert.equal(m.script, undefined);
    assert.equal(m.ref, 'packages/core:nosuch');
  });

  it('路径与 name 均未命中 → 未解析，保留原始 ref', () => {
    const m = resolveRef('ghost/pkg:dev', MONO);
    assert.equal(m.project, undefined);
    assert.equal(m.ref, 'ghost/pkg:dev');
  });

  it('解析命中后透传调用方的原始对象（raw）', () => {
    const m = resolveRef('apps/admin:build', MONO);
    assert.equal((m.project as { raw: string }).raw, '<apps/admin|admin-app>');
  });
});

describe('resolveGroups', () => {
  it('空配置 → 空数组', () => {
    assert.deepEqual(resolveGroups({}, MONO), []);
  });

  it('多组保序，组内成员逐个解析（未解析成员保留）', () => {
    const groups = {
      'dev-all': ['apps/web:dev', 'packages/core:dev', 'ghost:dev'],
      build: ['packages/core:build'],
    };
    const out = resolveGroups(groups, MONO);
    assert.equal(out.length, 2);
    assert.equal(out[0].name, 'dev-all');
    assert.equal(out[0].members.length, 3);
    assert.ok(out[0].members[0].project);
    assert.ok(out[0].members[1].project);
    assert.equal(out[0].members[2].project, undefined, '未解析成员保留占位');
    assert.equal(out[1].members[0].script, 'build');
  });

  it('脏配置条目（非字符串成员/非数组值）被过滤，不抛异常', () => {
    const groups: Record<string, unknown> = {
      g: ['apps/web:dev', 42, null],
      bad: 'not-an-array',
    };
    const out = resolveGroups(groups as Record<string, readonly string[]>, MONO);
    const g = out.find((x) => x.name === 'g')!;
    assert.equal(g.members.length, 1);
    assert.equal(out.find((x) => x.name === 'bad')!.members.length, 0);
  });
});

describe('makeRef', () => {
  it('子包项目 → 相对路径:脚本（防重名歧义）', () => {
    assert.equal(makeRef('apps/web', 'web-app', 'dev'), 'apps/web:dev');
  });

  it('根项目（relativeDir "."）→ 项目名:脚本', () => {
    assert.equal(makeRef('.', 'root-suite', 'dev'), 'root-suite:dev');
  });

  it('生成的 ref 可被 resolveRef 再次解析（round-trip）', () => {
    const ref = makeRef('apps/web', 'web-app', 'dev:watch');
    const m = resolveRef(ref, MONO);
    assert.equal(m.project, MONO[0]);
    assert.equal(m.script, 'dev:watch');
  });
});

describe('monorepo fixture round-trip（fixtures/mono 真实目录结构）', () => {
  const monoRoot = path.join(__dirname, '..', 'fixtures', 'mono');
  const webDir = path.join(monoRoot, 'packages', 'web');
  const adminDir = path.join(monoRoot, 'packages', 'admin');
  // 模拟扩展扫描 fixtures/mono 得到的项目集（真实绝对路径 + 真实脚本声明）
  const projects: (GroupProjectLike & { dir: string })[] = [
    { name: 'mono-suite', relativeDir: relativeDirOf(monoRoot, [{ name: 'mono', fsPath: monoRoot }]), scripts: new Set(['dev', 'build']), dir: monoRoot },
    { name: 'web-app', relativeDir: relativeDirOf(webDir, [{ name: 'mono', fsPath: monoRoot }]), scripts: new Set(['dev', 'dev:watch']), dir: webDir },
    { name: 'admin-app', relativeDir: relativeDirOf(adminDir, [{ name: 'mono', fsPath: monoRoot }]), scripts: new Set(['dev']), dir: adminDir },
  ];

  it('单根工作区：子包相对路径、根项目用项目名（Windows 反斜杠真实路径）', () => {
    const folders = [{ name: 'mono', fsPath: monoRoot }];
    assert.equal(relativeDirOf(webDir, folders), path.join('packages', 'web').replace(/\\/g, '/'));
    assert.equal(relativeDirOf(monoRoot, folders), '.');
  });

  it('右键添加生成的 ref 能解析回同一项目与脚本（全链路 round-trip）', () => {
    for (const p of projects) {
      for (const script of p.scripts) {
        const ref = makeRef(p.relativeDir, p.name, script);
        const m = resolveRef(ref, projects);
        assert.equal(m.project, p, `${ref} 应回到原项目`);
        assert.equal(m.script, script);
      }
    }
  });

  it('多根工作区：项目标识加 folder 名前缀且仍可解析', () => {
    const folders = [
      { name: 'mono', fsPath: monoRoot },
      { name: 'other', fsPath: path.join(monoRoot, '..', 'app-a') },
    ];
    const relWeb = relativeDirOf(webDir, folders);
    const relRoot = relativeDirOf(monoRoot, folders);
    assert.equal(relWeb, `mono/${path.join('packages', 'web').replace(/\\/g, '/')}`);
    assert.equal(relRoot, 'mono');
    const stamped = projects.map((p) =>
      p.dir === webDir ? { ...p, relativeDir: relWeb } : p.dir === monoRoot ? { ...p, relativeDir: relRoot } : p
    );
    assert.equal(resolveRef(makeRef(relWeb, 'web-app', 'dev'), stamped).project, stamped[1]);
    assert.equal(resolveRef(makeRef(relRoot, 'mono-suite', 'dev'), stamped).project, stamped[0]);
  });
});
