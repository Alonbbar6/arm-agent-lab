import type { Point } from "./types";
export const BASE: Point = { x: 0, z: 0.12 };
export const LINKS = [0.42, 0.38, 0.12] as const;
export const JOINT_LIMITS = [[-0.25, 2.95], [-2.95, 2.95], [-2.95, 2.95]] as const;
export const MAX_SPEED = 0.5;
export const PAYLOAD_LIMIT = 0.6;
export const HOME: Point = { x: 0.22, z: 0.40 };
export function forwardKinematics(joints: number[]): Point[] {
  const points: Point[] = [{ ...BASE }];
  let angle = 0;
  LINKS.forEach((length, i) => {
    angle += joints[i] ?? 0;
    const prev = points[points.length - 1]!;
    points.push({ x: prev.x + length * Math.cos(angle), z: prev.z + length * Math.sin(angle) });
  });
  return points;
}
export function withinJointLimits(joints: number[]): boolean {
  return joints.length === 3 && joints.every((v, i) => Number.isFinite(v) && v >= JOINT_LIMITS[i]![0] && v <= JOINT_LIMITS[i]![1]);
}
// Vertical wrist orientation removes the redundant third degree of freedom.
export function inverseKinematics(point: Point): number[] | null {
  const wx = point.x - BASE.x;
  const wz = point.z - BASE.z + LINKS[2];
  const c = (wx * wx + wz * wz - LINKS[0] ** 2 - LINKS[1] ** 2) / (2 * LINKS[0] * LINKS[1]);
  if (!Number.isFinite(c) || c < -1 - 1e-10 || c > 1 + 1e-10) return null;
  const q2 = -Math.acos(Math.max(-1, Math.min(1, c)));
  const q1 = Math.atan2(wz, wx) - Math.atan2(LINKS[1] * Math.sin(q2), LINKS[0] + LINKS[1] * Math.cos(q2));
  const q3 = -Math.PI / 2 - q1 - q2;
  return [q1, q2, q3];
}
