import { strict as assert } from 'assert';
import {
  ProcessInfo,
  buildProcessIndex,
  collectSubtreePids,
} from '../src/processTree';

const P = (pid: number, ppid: number, name = 'p'): ProcessInfo => ({ pid, ppid, name });

describe('collectSubtreePids', () => {
  it('返回包含根在内的整棵子树', () => {
    // cmd(100) -> node(200) -> vite(300), esbuild(301)；other(999) 不相关
    const index = buildProcessIndex([
      P(100, 1, 'cmd.exe'),
      P(200, 100, 'node.exe'),
      P(300, 200, 'node.exe'),
      P(301, 200, 'esbuild.exe'),
      P(999, 1, 'other.exe'),
    ]);
    const pids = collectSubtreePids(100, index);
    assert.deepEqual([...pids].sort((a, b) => a - b), [100, 200, 300, 301]);
  });

  it('叶子进程仅返回自身', () => {
    const index = buildProcessIndex([P(300, 200)]);
    assert.deepEqual([...collectSubtreePids(300, index)], [300]);
  });

  it('根 PID 不在快照中返回空集', () => {
    const index = buildProcessIndex([P(1, 0)]);
    assert.deepEqual([...collectSubtreePids(404, index)], []);
  });

  it('父子环不死循环', () => {
    // 构造 a.ppid=b, b.ppid=a 的异常数据
    const index = buildProcessIndex([P(10, 20), P(20, 10)]);
    const pids = collectSubtreePids(10, index);
    assert.deepEqual([...pids].sort((a, b) => a - b), [10, 20]);
  });

  it('深层子树包含所有后代', () => {
    const index = buildProcessIndex([
      P(1, 0),
      P(2, 1),
      P(3, 2),
      P(4, 3),
      P(5, 4),
    ]);
    const pids = collectSubtreePids(2, index);
    assert.deepEqual([...pids].sort((a, b) => a - b), [2, 3, 4, 5]);
  });
});
