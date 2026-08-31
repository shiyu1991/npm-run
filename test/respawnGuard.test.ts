import { strict as assert } from 'assert';
import { isDependentWorker } from '../src/respawnGuard';

describe('isDependentWorker（已知依赖父进程的 worker 特征表）', () => {
  it('Next.js start-server worker（Windows 反斜杠路径）命中', () => {
    assert.equal(
      isDependentWorker(
        '"C:\\Program Files\\nodejs\\node.exe" d:\\proj\\node_modules\\next\\dist\\server\\lib\\start-server.js'
      ),
      true
    );
  });

  it('Unix 正斜杠路径同样命中', () => {
    assert.equal(
      isDependentWorker('/usr/bin/node /home/u/proj/node_modules/next/dist/server/lib/start-server.js'),
      true
    );
  });

  it('大小写不敏感（盘符与包名大写混合）', () => {
    assert.equal(
      isDependentWorker('node D:\\Proj\\node_modules\\Next\\dist\\server\\lib\\start-server.js'),
      true
    );
  });

  it('普通 dev server 不命中（vite / concurrently / 裸 node server.js）', () => {
    assert.equal(isDependentWorker('node d:\\proj\\node_modules\\vite\\bin\\vite.js --host'), false);
    assert.equal(isDependentWorker('node d:\\proj\\node_modules\\.bin\\concurrently npm:*'), false);
    assert.equal(isDependentWorker('node server.js'), false);
  });

  it('相似文件名不误伤（my-start-server.js / start-server.jsx）', () => {
    assert.equal(isDependentWorker('node d:\\proj\\my-start-server.js'), false);
    assert.equal(
      isDependentWorker('node d:\\proj\\node_modules\\next\\dist\\server\\lib\\start-server.jsx'),
      false
    );
  });

  it('cmdline 缺省（快照拿不到）不命中、不抛错', () => {
    assert.equal(isDependentWorker(undefined), false);
    assert.equal(isDependentWorker(''), false);
  });
});
