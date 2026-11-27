import { BASE, LINKS, PAYLOAD_LIMIT, forwardKinematics, inverseKinematics, withinJointLimits } from "./kinematics";
import type { Point, Scene } from "./types";
export class SafetyError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "SafetyError"; }
}
export function segmentHitsZone(a: Point, b: Point, zone: Scene["keepOut"], margin = .006): boolean {
  // Slab intersection, including boundary contact.
  let lo = 0, hi = 1;
  for (const [p, delta, min, max] of [[a.x, b.x - a.x, zone.xMin - margin, zone.xMax + margin], [a.z, b.z - a.z, zone.zMin - margin, zone.zMax + margin]]) {
    if (Math.abs(delta!) < 1e-12) { if (p! < min! || p! > max!) return false; }
    else { const t1 = (min! - p!) / delta!, t2 = (max! - p!) / delta!; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); if (lo > hi) return false; }
  }
  return true;
}
export function checkMove(scene: Scene, target: Point): number[] {
  const start = scene.arm.position;
  if (target.z < 0) throw new SafetyError("BELOW_TABLE", "Gripper cannot move below the table.");
  if (segmentHitsZone(start, target, scene.keepOut)) throw new SafetyError("KEEP_OUT", "Path crosses the human keep-out zone.");
  if (Math.hypot(target.x - BASE.x, target.z - BASE.z) > LINKS.reduce((a, b) => a + b, 0) + 1e-9)
    throw new SafetyError("OUT_OF_REACH", "Target exceeds the arm's maximum reach.");
  const held = scene.blocks.find(b => b.id === scene.arm.heldBlock);
  if (held && held.mass > PAYLOAD_LIMIT) throw new SafetyError("PAYLOAD", "Held payload exceeds 0.6 kg.");
  const distance = Math.hypot(target.x - start.x, target.z - start.z);
  const steps = Math.max(1, Math.ceil(distance / .002));
  let joints: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = { x: start.x + (target.x - start.x) * i / steps, z: start.z + (target.z - start.z) * i / steps };
    const solution = inverseKinematics(p);
    if (!solution) throw new SafetyError("OUT_OF_REACH", "Straight path leaves the inverse-kinematics workspace.");
    if (!withinJointLimits(solution)) throw new SafetyError("JOINT_LIMIT", "Path violates a joint limit.");
    const points = forwardKinematics(solution);
    for (let j = 1; j < points.length; j++) {
      if (segmentHitsZone(points[j - 1]!, points[j]!, scene.keepOut)) throw new SafetyError("KEEP_OUT", "An arm link would enter the human keep-out zone.");
      if (points[j]!.z < -1e-8) throw new SafetyError("BELOW_TABLE", "An arm link would enter the table.");
    }
    if (held) {
      if (p.z - held.size / 2 < -1e-8) throw new SafetyError("BELOW_TABLE", "Held block would pass below the table.");
      if (segmentHitsZone(p, p, scene.keepOut, held.size / 2)) throw new SafetyError("KEEP_OUT", "Held block would enter the human keep-out zone.");
    }
    joints = solution;
  }
  return joints;
}
