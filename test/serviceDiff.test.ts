import { strict as assert } from 'assert';
import { diffServices, ServiceSnapshot } from '../src/serviceDiff';

const S = (port: number, pid: number, addresses: string[] = ['0.0.0.0']): ServiceSnapshot => ({
  port,
  pid,
  addresses,
});

describe('diffServices', () => {
  it('检测新增端口', () => {
    const prev = new Map<number, ServiceSnapshot>();
    const next = new Map([[5173, S(5173, 100)]]);
    const { added, removed, changed } = diffServices(prev, next);
    assert.deepEqual(added, [S(5173, 100)]);
    assert.deepEqual(removed, []);
    assert.deepEqual(changed, []);
  });

  it('检测消失端口', () => {
    const prev = new Map([
      [5173, S(5173, 100)],
      [3000, S(3000, 100)],
    ]);
    const next = new Map([[3000, S(3000, 100)]]);
    const { added, removed, changed } = diffServices(prev, next);
    assert.deepEqual(added, []);
    assert.deepEqual(removed, [5173]);
    assert.deepEqual(changed, []);
  });

  it('同端口 pid 变化标记为 changed（服务重启）', () => {
    const prev = new Map([[5173, S(5173, 100)]]);
    const next = new Map([[5173, S(5173, 200)]]);
    const { added, removed, changed } = diffServices(prev, next);
    assert.deepEqual(added, []);
    assert.deepEqual(removed, []);
    assert.deepEqual(changed, [S(5173, 200)]);
  });

  it('地址列表变化也标记为 changed', () => {
    const prev = new Map([[5173, S(5173, 100, ['0.0.0.0'])]]);
    const next = new Map([[5173, S(5173, 100, ['0.0.0.0', '[::]'])]]);
    const { changed } = diffServices(prev, next);
    assert.deepEqual(changed, [S(5173, 100, ['0.0.0.0', '[::]'])]);
  });

  it('无变化返回全空', () => {
    const prev = new Map([[5173, S(5173, 100)]]);
    const next = new Map([[5173, S(5173, 100)]]);
    const { added, removed, changed } = diffServices(prev, next);
    assert.deepEqual(added, []);
    assert.deepEqual(removed, []);
    assert.deepEqual(changed, []);
  });
});
