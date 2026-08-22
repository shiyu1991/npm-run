import * as vscode from 'vscode';

/** 工作区内扫描到的一个 npm 项目 */
export interface NpmProject {
  /** package.json 的 name 字段，缺省时用目录名 */
  name: string;
  /** 项目根目录 */
  dir: vscode.Uri;
  /** package.json 路径 */
  packageJsonUri: vscode.Uri;
  /** 脚本名 → 命令 */
  scripts: Map<string, string>;
}

/** 一个监听端口的服务 */
export interface ServiceInfo {
  /** 监听端口 */
  port: number;
  /** 监听地址列表（如 ['0.0.0.0', '[::]']，双栈监听时多个） */
  addresses: string[];
  /** 实际监听的进程 PID */
  pid: number;
  /** 监听进程是否为脚本根进程本身（根进程不可单独结束，只能停止整个脚本） */
  isRoot: boolean;
}

/** 一个正在运行的脚本实例 */
export interface RunningScript {
  project: NpmProject;
  script: string;
  /** 扩展 spawn 的根进程 PID（Windows 下为 cmd/npm 包装层） */
  rootPid: number;
  /** 端口 → 服务 */
  services: Map<number, ServiceInfo>;
  /** 该实例的输出通道 */
  output: vscode.OutputChannel;
}
