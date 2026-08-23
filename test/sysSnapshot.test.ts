import { strict as assert } from 'assert';
import { parseProcessListWin, parseProcessListUnix } from '../src/sysSnapshot';

describe('parseProcessList（进程快照解析，含命令行）', () => {
  it('Windows：解析 pid|ppid|name|cmdline 行，提取完整命令行', () => {
    const out = [
      '123|45|node.exe|node  server-b.js',
      '200|100|cmd.exe|"C:\\Windows\\system32\\cmd.exe" /d /s /c node server-a.js',
      '',
    ].join('\n');
    const procs = parseProcessListWin(out);
    assert.equal(procs.length, 2);
    assert.deepEqual(procs[0], {
      pid: 123,
      ppid: 45,
      name: 'node.exe',
      cmdline: 'node  server-b.js',
    });
    assert.equal(procs[1].cmdline?.includes('server-a.js'), true);
  });

  it('Windows：命令行含 | 字符时不丢内容（限次切分）', () => {
    const procs = parseProcessListWin('1|2|sh.exe|echo a|b|c');
    assert.equal(procs[0].cmdline, 'echo a|b|c');
  });

  it('Windows：CommandLine 为空（系统进程拒绝访问）时 cmdline 为 undefined', () => {
    const procs = parseProcessListWin('4|1|svchost.exe|');
    assert.equal(procs[0].name, 'svchost.exe');
    assert.equal(procs[0].cmdline, undefined);
  });

  it('Windows：非数字 pid/ppid 与残缺行跳过', () => {
    const out = ['abc|1|x|y', '5|6|a.exe', 'garbage'].join('\n');
    assert.equal(parseProcessListWin(out).length, 1);
  });

  it('Unix：解析 pid ppid args 行，args 含空格路径完整保留', () => {
    const out = [
      ' 101  1  /usr/local/bin/node /opt/my app/server.js --port 3000',
      '102 101 node server-b.js',
      '',
    ].join('\n');
    const procs = parseProcessListUnix(out);
    assert.equal(procs.length, 2);
    assert.equal(procs[0].pid, 101);
    assert.equal(procs[0].ppid, 1);
    assert.equal(procs[0].cmdline, '/usr/local/bin/node /opt/my app/server.js --port 3000');
    assert.equal(procs[1].cmdline, 'node server-b.js');
  });
});
