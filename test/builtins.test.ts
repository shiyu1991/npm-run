import { strict as assert } from 'assert';
import { builtinCommands, commandLine, detectPackageManager } from '../src/builtins';

describe('builtinCommands（按包管理器生成命令表）', () => {
  it('npm：install / ci / update / uninstall <pkg> / prune / outdated', () => {
    const list = builtinCommands('npm');
    assert.deepEqual(list.map((c) => c.id), [
      'install',
      'ci',
      'update',
      'remove',
      'prune',
      'outdated',
    ]);
    const remove = list.find((c) => c.id === 'remove')!;
    assert.deepEqual(remove.args, ['uninstall', '<pkg>']);
    assert.equal(remove.needsPackage, true);
  });

  it('pnpm：ci 用 install --frozen-lockfile，移除用 remove', () => {
    const list = builtinCommands('pnpm');
    assert.deepEqual(list.find((c) => c.id === 'ci')!.args, ['install', '--frozen-lockfile']);
    assert.deepEqual(list.find((c) => c.id === 'remove')!.args, ['remove', '<pkg>']);
    assert.deepEqual(list.find((c) => c.id === 'update')!.args, ['update']);
  });

  it('yarn：update 用 upgrade，且没有 prune 等价物时不提供该条目', () => {
    const list = builtinCommands('yarn');
    assert.deepEqual(list.find((c) => c.id === 'update')!.args, ['upgrade']);
    assert.deepEqual(list.find((c) => c.id === 'remove')!.args, ['remove', '<pkg>']);
    assert.equal(list.some((c) => c.id === 'prune'), false);
  });

  it('仅 remove 需要包名，其余命令无 needsPackage', () => {
    for (const pm of ['npm', 'pnpm', 'yarn'] as const) {
      for (const cmd of builtinCommands(pm)) {
        assert.equal(cmd.needsPackage ?? false, cmd.id === 'remove');
      }
    }
  });
});

describe('commandLine', () => {
  it('拼出完整命令行', () => {
    assert.equal(
      commandLine('pnpm', ['install', '--frozen-lockfile']),
      'pnpm install --frozen-lockfile'
    );
  });

  it('<pkg> 占位可替换为目标包名', () => {
    const args = ['uninstall', '<pkg>'].map((a) => (a === '<pkg>' ? 'lodash' : a));
    assert.equal(commandLine('npm', args), 'npm uninstall lodash');
  });
});

describe('detectPackageManager（lockfile 判定）', () => {
  it('pnpm-lock.yaml 优先于其他 lockfile', () => {
    assert.equal(detectPackageManager(['package-lock.json', 'pnpm-lock.yaml']), 'pnpm');
  });

  it('yarn.lock → yarn', () => {
    assert.equal(detectPackageManager(['yarn.lock']), 'yarn');
  });

  it('仅有 package-lock.json 或无 lockfile → npm', () => {
    assert.equal(detectPackageManager(['package-lock.json']), 'npm');
    assert.equal(detectPackageManager([]), 'npm');
  });
});
