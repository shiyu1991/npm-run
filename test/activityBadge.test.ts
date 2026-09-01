import { strict as assert } from 'assert';
import { activityBadgeCount } from '../src/activityBadge';

describe('activityBadgeCount（活动栏徽标计数口径）', () => {
  it('无实例无外部运行 → 0', () => {
    assert.equal(activityBadgeCount([], []), 0);
  });

  it('实例尚未检出端口按 1 计', () => {
    assert.equal(activityBadgeCount([{ services: { size: 0 } }], []), 1);
  });

  it('实例按监听服务数计', () => {
    assert.equal(activityBadgeCount([{ services: { size: 3 } }], []), 3);
  });

  it('外部运行按端口数计，无端口至少 1', () => {
    assert.equal(activityBadgeCount([], [{ hit: { ports: [3000, 3001] } }]), 2);
    assert.equal(activityBadgeCount([], [{ hit: { ports: [] } }]), 1);
  });

  it('多实例与外部运行混合聚合：2 + 1 + 3 = 6', () => {
    assert.equal(
      activityBadgeCount(
        [{ services: { size: 2 } }, { services: { size: 0 } }],
        [{ hit: { ports: [45731, 45732, 45800] } }]
      ),
      6
    );
  });
});
