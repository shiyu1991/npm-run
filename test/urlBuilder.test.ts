import { strict as assert } from 'assert';
import { toBrowseUrl } from '../src/urlBuilder';

describe('toBrowseUrl（监听地址 → 浏览器 URL）', () => {
  it('通配地址（0.0.0.0 / [::] / *）转为 localhost', () => {
    assert.equal(toBrowseUrl(['0.0.0.0'], 8080), 'http://localhost:8080');
    assert.equal(toBrowseUrl(['[::]'], 8080), 'http://localhost:8080');
    assert.equal(toBrowseUrl(['*'], 3000), 'http://localhost:3000');
  });

  it('回环地址转为 localhost', () => {
    assert.equal(toBrowseUrl(['127.0.0.1'], 5173), 'http://localhost:5173');
    assert.equal(toBrowseUrl(['::1'], 5173), 'http://localhost:5173');
    assert.equal(toBrowseUrl(['[::1]'], 5173), 'http://localhost:5173');
  });

  it('双栈监听（IPv4 通配 + IPv6 通配）仍用 localhost', () => {
    assert.equal(toBrowseUrl(['0.0.0.0', '[::]'], 8080), 'http://localhost:8080');
  });

  it('多网卡监听优先本机回环', () => {
    assert.equal(toBrowseUrl(['192.168.1.5', '0.0.0.0'], 8080), 'http://localhost:8080');
  });

  it('局域网地址原样保留', () => {
    assert.equal(toBrowseUrl(['192.168.1.5'], 8080), 'http://192.168.1.5:8080');
  });

  it('IPv6 非回环地址自动补方括号', () => {
    assert.equal(toBrowseUrl(['fe80::1'], 8080), 'http://[fe80::1]:8080');
    assert.equal(toBrowseUrl(['[fe80::1]'], 8080), 'http://[fe80::1]:8080');
  });

  it('地址列表为空时回退 localhost', () => {
    assert.equal(toBrowseUrl([], 8080), 'http://localhost:8080');
  });

  it('地址含空白/大写不影响判定', () => {
    assert.equal(toBrowseUrl([' 127.0.0.1 '], 80), 'http://localhost:80');
  });

  it('端口 443 用 https，其余 http', () => {
    assert.equal(toBrowseUrl(['0.0.0.0'], 443), 'https://localhost:443');
    assert.equal(toBrowseUrl(['0.0.0.0'], 8443), 'http://localhost:8443');
  });
});
