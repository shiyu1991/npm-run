import * as vscode from 'vscode';
import { ExternalHit } from './externalDetect';
import { PackageManager } from './builtins';

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
  /** 项目使用的包管理器（按 lockfile 判定，缺省 npm） */
  packageManager: PackageManager;
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
  /** 该服务的完整启动命令行（快照拿不到时缺省；单服务重启的凭据） */
  cmdline?: string;
}

/** 一个正在运行的脚本实例 */
export interface RunningScript {
  project: NpmProject;
  script: string;
  /** 扩展 spawn 的根进程 PID（Windows 下为 cmd/npm 包装层） */
  rootPid: number;
  /** 端口 → 服务 */
  services: Map<number, ServiceInfo>;
  /** 扩展代管拉起的进程（单服务重启产生），停止/退出脚本时一并清理 */
  adoptedPids: Set<number>;
  /** 脚本根进程已退出、仅剩代管服务在运行（launcher 类脚本在子进程全部被替换后会自然退出） */
  adoptedOnly?: boolean;
  /** 本次运行是否已提示过"检测到端口监听"（每次 run 新建实例，天然只提示一次） */
  firstPortAnnounced?: boolean;
  /** 用户主动停止（stop/重启的杀进程阶段）：close 事件到达时 onExit 不作崩溃通知 */
  userInitiatedStop?: boolean;
  /** 该实例的输出通道 */
  output: vscode.OutputChannel;
}

/** 外部运行检测结果（手动刷新快照的包装，hit 之上附检测时间） */
export interface ExternalState {
  hit: ExternalHit;
  /** 检测时间戳（ms） */
  detectedAt: number;
}
