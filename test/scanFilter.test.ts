import { strict as assert } from 'assert';
import { parseProjects } from '../src/scanFilter';

describe('parseProjects（package.json 解析与过滤）', () => {
  it('解析 name 与 scripts', () => {
    const projects = parseProjects([
      { dir: '/ws/app-a', content: '{"name":"app-a","scripts":{"dev":"vite","build":"vite build"}}' },
    ]);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'app-a');
    assert.equal(projects[0].dir, '/ws/app-a');
    assert.equal(projects[0].scripts.get('dev'), 'vite');
    assert.equal(projects[0].scripts.get('build'), 'vite build');
  });

  it('无 name 字段时回退到目录名', () => {
    const projects = parseProjects([
      { dir: '/ws/packages/sub-app', content: '{"scripts":{"dev":"node server.js"}}' },
    ]);
    assert.equal(projects[0].name, 'sub-app');
  });

  it('无 scripts 的项目被排除', () => {
    const projects = parseProjects([
      { dir: '/ws/empty', content: '{"name":"empty"}' },
      { dir: '/ws/blank', content: '{"name":"blank","scripts":{}}' },
      { dir: '/ws/has', content: '{"name":"has","scripts":{"dev":"x"}}' },
    ]);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'has');
  });

  it('非法 JSON 跳过且不抛错', () => {
    const projects = parseProjects([
      { dir: '/ws/broken', content: '{oops' },
      { dir: '/ws/ok', content: '{"name":"ok","scripts":{"dev":"x"}}' },
    ]);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'ok');
  });

  it('content 非 object（如数组/字符串）跳过', () => {
    const projects = parseProjects([
      { dir: '/ws/arr', content: '[1,2,3]' },
      { dir: '/ws/str', content: '"hello"' },
    ]);
    assert.equal(projects.length, 0);
  });

  it('保留 name 相同的多个项目（monorepo 常见）', () => {
    const projects = parseProjects([
      { dir: '/ws/a', content: '{"name":"app","scripts":{"dev":"x"}}' },
      { dir: '/ws/b', content: '{"name":"app","scripts":{"dev":"y"}}' },
    ]);
    assert.equal(projects.length, 2);
  });

  it('按目录路径排序保证稳定输出', () => {
    const projects = parseProjects([
      { dir: '/ws/z-b', content: '{"name":"b","scripts":{"dev":"x"}}' },
      { dir: '/ws/a-c', content: '{"name":"c","scripts":{"dev":"x"}}' },
      { dir: '/ws/m-a', content: '{"name":"a","scripts":{"dev":"x"}}' },
    ]);
    assert.deepEqual(projects.map((p) => p.dir), ['/ws/a-c', '/ws/m-a', '/ws/z-b']);
  });
});
