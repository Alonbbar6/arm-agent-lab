import { createScene } from "./scene";
import { forwardKinematics, withinJointLimits } from "./kinematics";
import { checkMove } from "./safety";
import type { Scene } from "./types";
// Validate client snapshots against fixed simulator configuration; never trust client limits.
export function validateScene(raw: unknown): Scene {
  const s = JSON.parse(JSON.stringify(raw)) as Scene;
  if (!s || !Number.isInteger(s.seed) || s.seed < 0) throw new Error("Invalid scene seed.");
  const reference = createScene(s.scenario, s.seed);
  if (JSON.stringify(s.slots) !== JSON.stringify(reference.slots) || JSON.stringify(s.keepOut) !== JSON.stringify(reference.keepOut)) throw new Error("Scene safety configuration cannot be changed.");
  if (!Number.isInteger(s.faultsRemaining) || s.faultsRemaining < 0 || s.faultsRemaining > reference.faultsRemaining || !Number.isFinite(s.simTime) || s.simTime < 0) throw new Error("Invalid simulation state.");
  if (!s.arm || typeof s.arm.gripperOpen !== "boolean" || !withinJointLimits(s.arm.joints)) throw new Error("Invalid arm state.");
  const tip = forwardKinematics(s.arm.joints).at(-1)!;
  if (!Number.isFinite(s.arm.position.x) || !Number.isFinite(s.arm.position.z) || Math.hypot(tip.x - s.arm.position.x, tip.z - s.arm.position.z) > 1e-6) throw new Error("Inconsistent arm pose.");
  if (!Array.isArray(s.blocks) || s.blocks.length !== 5 || new Set(s.blocks.map(b => b.id)).size !== 5) throw new Error("Invalid blocks.");
  for (const b of s.blocks) {
    const ref = reference.blocks.find(v => v.id === b.id);
    if (!ref || b.size !== ref.size || b.mass !== ref.mass || b.color !== ref.color || b.homeX !== ref.homeX || !Number.isFinite(b.x) || !Number.isFinite(b.z) || b.z < 0 || b.z > .5 || b.x < .1 || b.x > 1.02) throw new Error("Invalid block dimensions or position.");
    if (b.restsOn === "gripper") {
      if (s.arm.heldBlock !== b.id || Math.abs(b.x - tip.x) > .012 || Math.abs(b.z + b.size / 2 - tip.z) > .012) throw new Error("Invalid held block.");
    } else if (b.restsOn === "table") { if (b.z !== 0) throw new Error("Unsupported floating block."); }
    else {
      const support = s.blocks.find(v => v.id === b.restsOn);
      if (!support || support.id === b.id || Math.abs(b.x - support.x) > .012 || Math.abs(b.z - support.z - support.size) > 1e-6) throw new Error("Invalid support relation.");
    }
  }
  if (s.arm.heldBlock !== null && (!s.blocks.some(b => b.id === s.arm.heldBlock && b.restsOn === "gripper") || s.arm.gripperOpen)) throw new Error("Invalid gripper state.");
  checkMove(s, s.arm.position);
  return s;
}
