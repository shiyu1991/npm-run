import { ListeningSocket } from './portScanner';
import { buildProcessIndex, collectSubtreePids } from './processTree';
import { ServiceSnapshot, diffServices } from './serviceDiff';
import { RunningScript, ServiceInfo } from './types';
import { snapshotProcesses, snapshotPorts } from './sysSnapshot';
import { ExternalService, computeExternalServices } from './externalServices';

/** 服务条目（端口快照查到的占用者） */
export interface PortOwner {
  port: number;
  pid: number;
}

/**
 * 全局单例监控循环：仅在有运行实例期间活跃，
 * 每 tick 一次进程快照 + 一次端口快照，按各实例进程子树 diff 端口增删。
 */
export class ServiceMonitor {
  private instances = new Map<string, RunningScript>();
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private lastSockets: ListeningSocket[] = [];
  private _external: ExternalService[] = [];
  private _visible = true;
  private _externalEnabled = true;

  constructor(
    private readonly onChange: () => void,
    private intervalMs: number,
    private readonly extensionHostPid: number = process.pid
  ) {}

  /** 视图可见性：不可见时停止外部检测轮询（托管脚本仍继续） */
  setVisible(v: boolean): void {
    this._visible = v;
    if (v && !this.timer && !this.ticking) {
      void this.tick();
    }
  }

  setExternalEnabled(v: boolean): void {
    this._externalEnabled = v;
  }

  get external(): readonly ExternalService[] {
    return this._external;
  }

  attach(key: string, instance: RunningScript): void {
    this.instances.set(key, instance);
    if (!this.timer && !this.ticking) {
      void this.tick();
    }
  }

  detach(key: string): void {
    this.instances.delete(key);
    if (this.instances.size === 0 && this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  get size(): number {
    return this.instances.size;
  }

  /** 查询某端口的当前占用进程（基于最近一次端口快照） */
  findPortOwner(port: number): PortOwner | undefined {
    const hit = this.lastSockets.find((s) => s.port === port);
    return hit ? { port: hit.port, pid: hit.pid } : undefined;
  }

  /** 轮询间隔热更新 */
  setInterval(ms: number): void {
    this.intervalMs = ms;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.instances.clear();
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const [procs, sockets] = await Promise.all([snapshotProcesses(), snapshotPorts()]);
      this.lastSockets = sockets;
      const index = buildProcessIndex(procs);
      let changed = false;

      for (const inst of this.instances.values()) {
        const subtree = collectSubtreePids(inst.rootPid, index);
        const next = new Map<number, ServiceSnapshot>();
        for (const s of sockets) {
          if (subtree.has(s.pid)) {
            next.set(s.port, { port: s.port, pid: s.pid, addresses: s.addresses });
          }
        }
        const prev = new Map<number, ServiceSnapshot>();
        for (const s of inst.services.values()) {
          prev.set(s.port, { port: s.port, pid: s.pid, addresses: s.addresses });
        }
        const diff = diffServices(prev, next);
        if (diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0) {
          const services = new Map<number, ServiceInfo>();
          for (const s of next.values()) {
            services.set(s.port, {
              port: s.port,
              addresses: s.addresses,
              pid: s.pid,
              isRoot: s.pid === inst.rootPid,
            });
          }
          inst.services = services;
          changed = true;
        }
      }

      if (changed) {
        this.onChange();
      }

      // 外部服务检测（IDE 树内、非托管、非 IDE 自身）：视图可见时才执行
      if (this._externalEnabled && this._visible) {
        const external = computeExternalServices({
          procs,
          sockets,
          extensionHostPid: this.extensionHostPid,
          managedRootPids: [...this.instances.values()].map((i) => i.rootPid),
        });
        const changedExt =
          external.length !== this._external.length ||
          external.some(
            (s, i) => s.pid !== this._external[i].pid || s.port !== this._external[i].port
          );
        if (changedExt) {
          this._external = external;
          this.onChange();
        }
      }
    } catch {
      // 快照失败（命令不可用等）：静默跳过本轮，下一轮重试
    } finally {
      this.ticking = false;
      if (this.instances.size > 0 || (this._externalEnabled && this._visible)) {
        this.timer = setTimeout(() => void this.tick(), this.intervalMs);
      } else {
        this.timer = undefined;
      }
    }
  }
}
