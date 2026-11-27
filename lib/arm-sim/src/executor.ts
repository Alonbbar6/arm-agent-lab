import type { Scene, ToolResult, ToolName } from "./types";
import { HOME, MAX_SPEED, PAYLOAD_LIMIT } from "./kinematics";
import { covered, dropBlock } from "./scene";
import { checkMove, SafetyError } from "./safety";
export function validateToolInput(name: string, raw: unknown): Record<string, unknown> {
  let value: unknown = raw;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw new SafetyError("INVALID_INPUT", "Tool arguments must be JSON."); } }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SafetyError("INVALID_INPUT", "Tool arguments must be an object.");
  const args = value as Record<string, unknown>;
  const allowed: Record<string, string[]> = { get_scene: [], move_to: ["x", "z"], grip: [], release: [], home: [], finish: ["status", "summary"] };
  if (!Object.hasOwn(allowed, name) || Object.keys(args).some(k => !allowed[name]!.includes(k))) throw new SafetyError("INVALID_INPUT", "Unknown tool or extra arguments.");
  if (name === "move_to" && !["x", "z"].every(k => typeof args[k] === "number" && Number.isFinite(args[k]))) throw new SafetyError("INVALID_INPUT", "x and z must be finite numbers.");
  if (name === "finish" && (!["done", "refused", "failed"].includes(String(args.status)) || typeof args.summary !== "string" || !args.summary.trim())) throw new SafetyError("INVALID_INPUT", "finish requires a valid status and summary.");
  return args;
}
// Transactional: every validation/safety failure leaves the original scene unchanged.
export function executeTool(scene: Scene, name: ToolName | string, raw: unknown): ToolResult {
  try {
    const args = validateToolInput(name, raw);
    const next: Scene = JSON.parse(JSON.stringify(scene));
    let result: ToolResult = { ok: true };
    if (name === "get_scene") return { ok: true, scene: next };
    if (name === "finish") return { ok: true, status: args.status as ToolResult["status"], summary: String(args.summary) };
    if (name === "move_to" || name === "home") {
      const target = name === "home" ? HOME : { x: args.x as number, z: args.z as number };
      const joints = checkMove(next, target);
      const durationMs = Math.hypot(target.x - next.arm.position.x, target.z - next.arm.position.z) / MAX_SPEED * 1000;
      next.arm.joints = joints; next.arm.position = { ...target }; next.simTime += durationMs / 1000;
      const held = next.blocks.find(b => b.id === next.arm.heldBlock);
      if (held) { held.x = target.x; held.z = target.z - held.size / 2; }
      result.durationMs = durationMs;
    } else if (name === "grip") {
      if (next.arm.heldBlock) throw new SafetyError("GRIPPER_BUSY", "Release the held block first.");
      const p = next.arm.position;
      const block = next.blocks.find(b => Math.abs(b.x - p.x) <= .012 && Math.abs(b.z + b.size / 2 - p.z) <= .012);
      if (block && covered(next, block.id)) throw new SafetyError("COVERED_BLOCK", "Block is covered. Unstack the top block first.");
      if (block && block.mass > PAYLOAD_LIMIT) throw new SafetyError("PAYLOAD", "Block mass exceeds the 0.6 kg payload limit.");
      next.arm.gripperOpen = false;
      const slip = block && next.faultsRemaining > 0;
      if (slip) next.faultsRemaining--;
      if (block && !slip) { next.arm.heldBlock = block.id; block.restsOn = "gripper"; }
      result.grasped = Boolean(block && !slip);
    } else if (name === "release") {
      const held = next.blocks.find(b => b.id === next.arm.heldBlock);
      if (held) dropBlock(next, held);
      next.arm.heldBlock = null; next.arm.gripperOpen = true;
    }
    Object.assign(scene, next);
    return { ...result, scene: JSON.parse(JSON.stringify(scene)) };
  } catch (error) {
    if (error instanceof SafetyError) return { ok: false, code: error.code, error: error.message };
    throw error;
  }
}
