import { HOME, inverseKinematics } from "./kinematics";
import type { Scene, Block } from "./types";
export const SCENARIOS = ["default", "scattered", "keep-out", "grasp-fault", "stacked"] as const;
export function createScene(scenario: string = "default", seed = 42, options: { graspFaults?: number } = {}): Scene {
  if (!(SCENARIOS as readonly string[]).includes(scenario)) throw new Error("Unknown scenario");
  if (options.graspFaults !== undefined && (!Number.isInteger(options.graspFaults) || options.graspFaults < 0 || options.graspFaults > 20)) throw new Error("graspFaults must be an integer from 0 to 20.");
  let rng = seed >>> 0;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  const blocks: Block[] = ["red", "blue", "green", "yellow", "heavy"].map((id, i) => ({
    id, color: id === "heavy" ? "gray" : id, x: [0.22, 0.36, 0.50, 0.64, 0.76][i]!,
    z: 0, size: 0.056, mass: id === "heavy" ? 1.2 : 0.15, restsOn: "table", homeX: [0.22, 0.36, 0.50, 0.64, 0.76][i]!,
  }));
  if (scenario === "scattered") blocks.slice(0, 4).forEach(b => { b.x += (random() - .5) * .055; });
  if (scenario === "keep-out") blocks[1]!.x = .90;
  if (scenario === "stacked") { blocks[0]!.x = blocks[1]!.x; blocks[0]!.z = blocks[1]!.size; blocks[0]!.restsOn = "blue"; }
  return { scenario, seed, arm: { joints: inverseKinematics(HOME)!, position: { ...HOME }, gripperOpen: true, heldBlock: null },
    blocks, slots: [0.22, 0.36, 0.50, 0.64, 0.76].map((x, i) => ({ id: i + 1, x })),
    keepOut: { xMin: .84, xMax: 1.02, zMin: 0, zMax: .28 }, faultsRemaining: options.graspFaults ?? (scenario === "grasp-fault" ? 2 : 0), simTime: 0 };
}
export function dropBlock(scene: Scene, block: Block): void {
  const support = scene.blocks.filter(b => b.id !== block.id && Math.abs(b.x - block.x) <= .012 && b.z + b.size <= block.z + .005)
    .sort((a, b) => (b.z + b.size) - (a.z + a.size))[0];
  block.z = support ? support.z + support.size : 0;
  block.restsOn = support?.id ?? "table";
}
export function covered(scene: Scene, id: string): boolean { return scene.blocks.some(b => b.restsOn === id); }
