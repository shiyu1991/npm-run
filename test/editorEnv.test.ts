import { strict as assert } from 'assert';
import { withEditorHints, spawnEnv } from '../src/editorEnv';

describe('withEditorHints（补齐集成终端的编辑器标识环境变量）', () => {
  it('空环境下注入 TERM_PROGRAM / VSCODE_PID / VSCODE_CWD', () => {
    const env = withEditorHints({}, { pid: 1234, cwd: 'd:/proj' });
    assert.equal(env.TERM_PROGRAM, 'vscode');
    assert.equal(env.VSCODE_PID, '1234');
    assert.equal(env.VSCODE_CWD, 'd:/proj');
  });

  it('已有同名变量不覆盖（编辑器从终端启动时已带正确值）', () => {
    const env = withEditorHints(
      { TERM_PROGRAM: 'vscode', VSCODE_PID: '999', VSCODE_CWD: 'd:/real' },
      { pid: 1234, cwd: 'd:/proj' }
    );
    assert.equal(env.TERM_PROGRAM, 'vscode');
    assert.equal(env.VSCODE_PID, '999');
    assert.equal(env.VSCODE_CWD, 'd:/real');
  });

  it('TERM_PROGRAM 非 vscode 时同样不覆盖（尊重外部终端环境）', () => {
    const env = withEditorHints({ TERM_PROGRAM: 'iTerm.app' }, { pid: 1 });
    assert.equal(env.TERM_PROGRAM, 'iTerm.app');
  });

  it('未提供 cwd 时不注入 VSCODE_CWD', () => {
    const env = withEditorHints({}, { pid: 1234 });
    assert.equal(env.VSCODE_CWD, undefined);
  });

  it('保留原有其他变量（PATH 等），不改引用语义外内容', () => {
    const original = { PATH: 'C:/bin', MY_VAR: 'x' };
    const env = withEditorHints(original, { pid: 7, cwd: 'd:/p' });
    assert.equal(env.PATH, 'C:/bin');
    assert.equal(env.MY_VAR, 'x');
    assert.equal(original.TERM_PROGRAM, undefined); // 原对象不被修改
  });
});

describe('spawnEnv（脚本进程完整环境组装）', () => {
  it('用户 env 注入且优先级最高（可覆盖基础层）', () => {
    const env = spawnEnv({ CODE_INSPECTOR: '1', NO_COLOR: '0' }, { pid: 42, cwd: 'd:/p' });
    assert.equal(env.CODE_INSPECTOR, '1');
    assert.equal(env.NO_COLOR, '0'); // 覆盖基础层的禁色设置
    assert.equal(env.CI, '1'); // 基础层其余项保留
  });

  it('数字/布尔值统一转字符串', () => {
    const env = spawnEnv({ A_NUM: 1, B_BOOL: true }, { pid: 42 });
    assert.equal(env.A_NUM, '1');
    assert.equal(env.B_BOOL, 'true');
  });

  it('undefined/null 项跳过不注入', () => {
    const env = spawnEnv({ A: undefined, B: null, C: 'x' }, { pid: 42 });
    assert.equal(env.A, undefined);
    assert.equal(env.B, undefined);
    assert.equal(env.C, 'x');
  });

  it('空配置仍有禁色基础层（编辑器标识注入由 withEditorHints 用例覆盖）', () => {
    const env = spawnEnv({}, { pid: 42, cwd: 'd:/p' });
    // TERM_PROGRAM / VSCODE_* 不在此断言：真实 process.env 可能已带（已有不覆盖是设计行为）
    assert.equal(env.FORCE_COLOR, '0');
    assert.equal(env.NO_COLOR, '1');
    assert.equal(env.CI, '1');
  });

  it('剥离 ELECTRON_RUN_AS_NODE（扩展宿主遗传该变量会让脚本启动的编辑器 exe 退化为纯 Node 模式，exit 9）', () => {
    const env = spawnEnv({}, { pid: 42 });
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  });
});
