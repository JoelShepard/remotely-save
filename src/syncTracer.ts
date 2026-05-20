import type {
  SyncOp,
  SyncOpType,
  SyncTraceResult,
  SyncTriggerSourceType,
} from "./baseTypes";

const MAX_OPS = 5000;

export class SyncTracer {
  private ops: SyncOp[] = [];
  private syncId = "";
  private startTime = 0;
  private lastTimestamp = 0;
  private triggerSource: SyncTriggerSourceType = "manual";
  private enabled = false;

  beginSync(triggerSource: SyncTriggerSourceType): string {
    this.ops = [];
    this.syncId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.startTime = Date.now();
    this.lastTimestamp = performance.now();
    this.triggerSource = triggerSource;
    this.enabled = true;
    this.recordOp({
      type: "phase",
      label: "sync_start",
      durationMs: 0,
    });
    return this.syncId;
  }

  endSync(): SyncTraceResult {
    if (!this.enabled) {
      return {
        syncId: "",
        startTime: 0,
        endTime: 0,
        ops: [],
        triggerSource: "manual",
      };
    }
    this.recordOp({
      type: "phase",
      label: "sync_end",
      durationMs: 0,
    });
    this.enabled = false;
    const result: SyncTraceResult = {
      syncId: this.syncId,
      startTime: this.startTime,
      endTime: Date.now(),
      ops: [...this.ops],
      triggerSource: this.triggerSource,
    };
    return result;
  }

  recordOp(op: Omit<SyncOp, "timestamp">): void {
    if (!this.enabled) return;
    const now = performance.now();
    const duration =
      op.durationMs > 0 ? op.durationMs : now - this.lastTimestamp;
    this.ops.push({
      ...op,
      timestamp: Date.now(),
      durationMs: Math.round(duration * 10) / 10,
    });
    this.lastTimestamp = now;
    if (this.ops.length > MAX_OPS) {
      this.ops.splice(0, this.ops.length - MAX_OPS);
    }
  }

  recordOpWithDuration(
    type: SyncOpType,
    label: string,
    durationMs: number,
    extra?: Partial<Omit<SyncOp, "timestamp" | "type" | "label" | "durationMs">>
  ): void {
    if (!this.enabled) return;
    this.ops.push({
      timestamp: Date.now(),
      type,
      label,
      durationMs: Math.round(durationMs * 10) / 10,
      ...extra,
    });
    if (this.ops.length > MAX_OPS) {
      this.ops.splice(0, this.ops.length - MAX_OPS);
    }
  }

  recordPhase(label: string): void {
    this.recordOp({ type: "phase", label, durationMs: 0 });
  }

  recordApiCall(
    apiName: string,
    durationMs: number,
    extra?: { key?: string; error?: string }
  ): void {
    this.recordOpWithDuration("api_call", apiName, durationMs, extra);
  }

  getOps(): SyncOp[] {
    return [...this.ops];
  }

  getWaterfallText(): string {
    if (this.ops.length === 0) return "No trace data.";

    const lines: string[] = [];
    const totalDuration =
      this.ops.length > 1
        ? this.ops[this.ops.length - 1].timestamp - this.ops[0].timestamp
        : 0;

    lines.push(`Sync Trace: ${this.syncId}`);
    lines.push(
      `Started: ${new Date(this.startTime).toISOString()}  |  Total: ${totalDuration}ms`
    );
    lines.push("");

    for (const op of this.ops) {
      const timeLabel = op.durationMs > 0 ? `${op.durationMs}ms` : "";
      const keyInfo = op.key ? `  [${op.key}]` : "";
      const errorInfo = op.error ? `  ERROR: ${op.error}` : "";
      const apiInfo = op.apiName ? `  (${op.apiName})` : "";
      lines.push(
        `  ${op.type.padEnd(10)} ${op.label}${apiInfo}${keyInfo}${errorInfo} ${timeLabel}`
      );
    }

    return lines.join("\n");
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getSyncId(): string {
    return this.syncId;
  }
}
