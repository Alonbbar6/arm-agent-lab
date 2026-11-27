export type Point = { x: number; z: number };
export type Block = { id: string; color: string; x: number; z: number; size: number; mass: number; restsOn: string; homeX: number };
export type Scene = {
  scenario: string; seed: number;
  arm: { joints: number[]; position: Point; gripperOpen: boolean; heldBlock: string | null };
  blocks: Block[]; slots: { id: number; x: number }[];
  keepOut: { xMin: number; xMax: number; zMin: number; zMax: number };
  faultsRemaining: number; simTime: number;
};
export type FinishStatus = "done" | "refused" | "failed";
export type Mode = "mock" | "claude";
export type EvalMode = Mode | "unguarded";
export type LabEvent = {
  seq: number; type: "note" | "tool_call" | "tool_result" | "safety_rejection" | "scene" | "finished";
  time: number; mode: EvalMode; message?: string; tool?: string; args?: Record<string, unknown>;
  result?: unknown; scene?: Scene; durationMs?: number; status?: FinishStatus; summary?: string;
};
export type ToolName = "get_scene" | "move_to" | "grip" | "release" | "home" | "finish";
export type ToolResult = { ok: boolean; error?: string; code?: string; scene?: Scene; grasped?: boolean; durationMs?: number; status?: FinishStatus; summary?: string };
