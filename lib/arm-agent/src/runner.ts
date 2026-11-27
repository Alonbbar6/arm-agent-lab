import { executeTool, type Scene, type EvalMode, type LabEvent, type ToolResult, type FinishStatus } from "@workspace/arm-sim";
export type RunOptions = { mode: EvalMode; emit?: (event: LabEvent) => void; signal?: AbortSignal; realtime?: boolean; maxSteps?: number };
export class Runner {
  events: LabEvent[] = [];
  status: FinishStatus | null = null;
  summary = "";
  graspRetries = 0;
  toolCalls = 0;
  safetyRejections = 0;
  private pendingGraspFailure = false;
  private needsGraspVerification = false;
  constructor(public scene: Scene, public options: RunOptions) {}
  emit(data: Omit<LabEvent, "seq" | "time" | "mode">): void {
    const event: LabEvent = { ...data, seq: this.events.length + 1, time: Date.now(), mode: this.options.mode };
    this.events.push(event); this.options.emit?.(event);
  }
  note(message: string): void { this.emit({ type: "note", message }); }
  async call(tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (this.status) return { ok: false, error: "Run already finished." };
    if (tool !== "finish" && this.options.signal?.aborted) throw new Error("Run stopped by user.");
    if (tool !== "finish" && this.toolCalls >= (this.options.maxSteps ?? 160)) throw new Error("Maximum tool-call budget reached.");
    this.toolCalls++;
    this.emit({ type: "tool_call", tool, args });
    let result: ToolResult;
    if (this.needsGraspVerification && tool !== "get_scene" && tool !== "finish") {
      result = { ok: false, code: "VERIFY_GRASP", error: "Call get_scene after every grip before any further action." };
    } else {
      result = executeTool(this.scene, tool, args);
    }
    if (!result.ok) { this.safetyRejections++; this.emit({ type: "safety_rejection", tool, message: result.error, result }); }
    if (tool === "grip" && result.ok) {
      if (this.pendingGraspFailure) this.graspRetries++;
      this.pendingGraspFailure = !result.grasped;
      this.needsGraspVerification = true;
    }
    if (tool === "get_scene" && result.ok) this.needsGraspVerification = false;
    this.emit({ type: "tool_result", tool, result });
    if (result.ok && result.scene) this.emit({ type: "scene", scene: result.scene, durationMs: result.durationMs ?? 0 });
    if (result.ok && tool === "finish") {
      this.status = result.status!; this.summary = result.summary!;
      this.emit({ type: "finished", status: this.status, summary: this.summary, scene: JSON.parse(JSON.stringify(this.scene)) });
    } else if (this.options.realtime) {
      await new Promise<void>(resolve => {
        const signal = this.options.signal;
        const end = () => { clearTimeout(timer); signal?.removeEventListener("abort", end); resolve(); };
        const timer = setTimeout(end, result.durationMs ?? 110);
        signal?.addEventListener("abort", end, { once: true });
        if (signal?.aborted) end();
      });
    }
    return result;
  }
  async finish(status: FinishStatus, summary: string): Promise<void> { await this.call("finish", { status, summary }); }
}
