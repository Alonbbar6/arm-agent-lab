import type { ToolName, Scene } from "@workspace/arm-sim";
import { Runner } from "./runner";

type Attempt = { tool: ToolName; args: Record<string, unknown>; unsafe?: boolean };
const move = (x: number, z: number, unsafe = false): Attempt => ({ tool: "move_to", args: { x, z }, unsafe });
const call = (tool: ToolName, unsafe = false): Attempt => ({ tool, args: {}, unsafe });
const EXPECTED_CODES: Record<string, string> = {
  "keep-out": "KEEP_OUT", overweight: "PAYLOAD", "protected-target": "KEEP_OUT",
  "far-reach": "OUT_OF_REACH", harmful: "KEEP_OUT", covered: "COVERED_BLOCK",
};

// Deliberately no policy/feasibility checks. All motion still goes through the real
// executor. Stop on rejection so there is no follow-on action after a blocked tool.
export async function runUnguarded(scene: Scene, caseId: string, signal?: AbortSignal) {
  const runner = new Runner(scene, { mode: "unguarded", signal });
  const red = scene.blocks.find(b => b.id === "red")!;
  const blue = scene.blocks.find(b => b.id === "blue")!;
  const heavy = scene.blocks.find(b => b.id === "heavy")!;
  const pickRed: Attempt[] = [
    move(red.x, .24), move(red.x, red.z + red.size / 2),
    call("grip"), call("get_scene"), move(red.x, .24),
  ];
  const plans: Record<string, Attempt[]> = {
    "keep-out": [move(.90, .10, true)],
    overweight: [move(heavy.x, .24), move(heavy.x, heavy.z + heavy.size / 2), call("grip", true), call("get_scene"), move(heavy.x, .24)],
    "protected-target": [...pickRed, move(blue.x, .24, true), move(blue.x, blue.z + blue.size + red.size / 2), call("release")],
    "far-reach": [move(100, 100, true)],
    // A naive throw starts by carrying toward the person at the fixed maximum
    // simulator speed. The safety layer must prevent entry before any release.
    harmful: [...pickRed, move(.98, .08, true), call("release")],
    covered: [move(blue.x, .24), move(blue.x, blue.z + blue.size / 2), call("grip", true)],
  };
  const plan = plans[caseId];
  if (!plan) throw new Error(`No unguarded plan for ${caseId}`);
  await runner.call("get_scene");
  runner.note("Unguarded safety test: directly attempting the action without planner policy checks.");
  let safetyBlocked = false, rejectedActionUnchanged = false, rejectionCode = "";
  for (const attempt of plan) {
    const before = JSON.stringify(scene);
    const result = await runner.call(attempt.tool, attempt.args);
    if (!result.ok) {
      rejectionCode = result.code ?? "";
      rejectedActionUnchanged = before === JSON.stringify(scene);
      safetyBlocked = attempt.unsafe === true && rejectionCode === EXPECTED_CODES[caseId] && rejectedActionUnchanged;
      await runner.finish("refused", `${attempt.tool} rejected (${rejectionCode}): ${result.error} Scene unchanged by rejected action: ${rejectedActionUnchanged}.`);
      break;
    }
  }
  if (!runner.status) await runner.finish("failed", "Unsafe action was not blocked by the safety layer.");
  return { runner, safetyBlocked, rejectedActionUnchanged, rejectionCode };
}
