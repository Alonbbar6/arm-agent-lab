import { describe, it, expect } from "vitest";
import { createScene, executeTool, forwardKinematics, inverseKinematics, withinJointLimits, dropBlock, MAX_SPEED, HOME, validateScene, checkMove } from "../lib/arm-sim/src/index";
import { runAgent } from "../lib/arm-agent/src/index";
import { runEval, EVAL_CASES, auditScenes } from "../lib/arm-agent/src/eval";

describe("kinematics", () => {
  it.each([{x:.22,z:.028},{x:.64,z:.24},{x:.50,z:.10},HOME])("round trips %j", point => {
    const joints = inverseKinematics(point)!;
    expect(withinJointLimits(joints)).toBe(true);
    const actual = forwardKinematics(joints).at(-1)!;
    expect(actual.x).toBeCloseTo(point.x, 9); expect(actual.z).toBeCloseTo(point.z, 9);
  });
  it("rejects unreachable IK", () => expect(inverseKinematics({x:9,z:9})).toBeNull());
});
describe("transactional safety", () => {
  it.each([
    ["OUT_OF_REACH", {x:10,z:2}],
    ["BELOW_TABLE", {x:.3,z:-.1}],
    ["KEEP_OUT", {x:.9,z:.1}],
    ["JOINT_LIMIT", {x:-.1,z:.1}],
  ])("rejects %s with no mutation", (code, point) => {
    const scene = createScene(), initial = JSON.stringify(scene);
    expect(executeTool(scene, "move_to", point).code).toBe(code);
    expect(JSON.stringify(scene)).toBe(initial);
  });
  it("rejects heavy payload before closing", () => {
    const s = createScene(); s.arm.position = {x:.76,z:.028}; s.arm.joints = inverseKinematics(s.arm.position)!;
    const initial = JSON.stringify(s);
    expect(executeTool(s, "grip", {}).code).toBe("PAYLOAD"); expect(JSON.stringify(s)).toBe(initial);
  });
  it("rejects picking a covered block", () => {
    const s = createScene("stacked"); s.arm.position = {x:.36,z:.028}; s.arm.joints = inverseKinematics(s.arm.position)!;
    const initial = JSON.stringify(s);
    expect(executeTool(s, "grip", {}).code).toBe("COVERED_BLOCK"); expect(JSON.stringify(s)).toBe(initial);
  });
  it("rejects a crossing even when endpoints lie outside the zone", () => {
    const s = createScene(); s.arm.position = {x:.80,z:.15};
    expect(executeTool(s, "move_to", {x:1.1,z:.15}).code).toBe("KEEP_OUT");
  });
  it("rejects extra/nonfinite/unknown tool inputs", () => {
    const s = createScene(), initial = JSON.stringify(s);
    for (const [tool, args] of [["move_to",{x:NaN,z:.1}],["grip",{force:true}],["teleport",{}],["move_to","not json"] ] as const)
      expect(executeTool(s, tool, args).code).toBe("INVALID_INPUT");
    expect(JSON.stringify(s)).toBe(initial);
  });
  it("derives duration from max speed", () => {
    const s = createScene(); const target = {x:.36,z:.24};
    const distance = Math.hypot(target.x-s.arm.position.x,target.z-s.arm.position.z);
    expect(executeTool(s,"move_to",target).durationMs).toBeCloseTo(distance/MAX_SPEED*1000);
  });
  it("rejects altered client safety limits", () => {
    const s = createScene(); s.blocks[4]!.mass=.1;
    expect(() => validateScene(s)).toThrow();
    expect(validateScene(createScene())).toBeTruthy();
  });
});
describe("physics and faults", () => {
  it("drops onto the highest aligned support", () => {
    const s = createScene(); const [red, blue, green] = s.blocks;
    red!.x=blue!.x; red!.z=.25; dropBlock(s, red!);
    expect(red!.restsOn).toBe("blue"); expect(red!.z).toBeCloseTo(.056);
    green!.x=blue!.x; green!.z=.30; dropBlock(s,green!);
    expect(green!.restsOn).toBe("red"); expect(green!.z).toBeCloseTo(.112);
  });
  it("drops to table when outside alignment tolerance", () => {
    const s = createScene(); const b = s.blocks[0]!; b.x=.40; b.z=.3; dropBlock(s,b);
    expect(b.z).toBe(0); expect(b.restsOn).toBe("table");
  });
  it("seeded scenarios are repeatable", () => {
    expect(createScene("scattered",19)).toEqual(createScene("scattered",19));
    expect(createScene("scattered",20)).not.toEqual(createScene("scattered",19));
  });
  it("slips exactly twice then grasps", () => {
    const s=createScene("grasp-fault"); s.arm.position={x:.22,z:.028}; s.arm.joints=inverseKinematics(s.arm.position)!;
    expect(executeTool(s,"grip",{}).grasped).toBe(false);
    executeTool(s,"release",{});
    expect(executeTool(s,"grip",{}).grasped).toBe(false);
    executeTool(s,"release",{});
    expect(executeTool(s,"grip",{}).grasped).toBe(true);
    expect(s.faultsRemaining).toBe(0);
  });
  it("misses a misaligned grasp", () => {
    const s=createScene(); s.arm.position={x:.25,z:.028};
    expect(executeTool(s,"grip",{}).grasped).toBe(false);
  });
  it("accepts a configurable deterministic slip count", () => {
    const s = createScene("default", 42, {graspFaults: 3});
    expect(s.faultsRemaining).toBe(3);
    expect(() => createScene("default", 42, {graspFaults: -1})).toThrow();
  });
});
describe("mock agent and evaluations", () => {
  it("passes all achievable cases and refuses all unsafe cases", async () => {
    expect(EVAL_CASES).toHaveLength(16);
    const report=await runEval("mock");
    expect(report.rows.filter(r=>!r.pass)).toEqual([]);
    expect(report.rows.filter(r=>r.graspRetries>=2)).toHaveLength(2);
    expect(report.passed).toBe(16);
  });
  it("supports moving into an empty neighboring slot", async () => {
    const s=createScene(); s.blocks[0]!.x=.36; s.blocks[0]!.z=.056; s.blocks[0]!.restsOn="blue";
    const run=await runAgent(s,"move green to the left",{mode:"mock"});
    expect(run.status).toBe("done"); expect(s.blocks[2]!.x).toBe(.22);
  });
  it("stops without executing further motion", async () => {
    const s=createScene(), controller=new AbortController(); controller.abort();
    const run=await runAgent(s,"stack red on blue",{mode:"mock",signal:controller.signal});
    expect(run.status).toBe("failed"); expect(run.events.at(-2)?.tool).toBe("finish");
    expect(run.toolCalls).toBe(1);
  });
  it("headless audit detects an unsafe executed pose", () => {
    const initial=createScene(), unsafe=createScene(); unsafe.arm.position={x:10,z:10};
    expect(auditScenes(initial,[{type:"scene",scene:unsafe}])).toBeGreaterThan(0);
  });
  it("all emitted movement segments are safe", async () => {
    const s=createScene(), prev=createScene();
    const run=await runAgent(s,"stack red on blue",{mode:"mock"});
    expect(auditScenes(prev,run.events)).toBe(0);
    expect(()=>checkMove(s,s.arm.position)).not.toThrow();
  });
});
