import { describe, expect, it } from "vitest";
import { createScene } from "../lib/arm-sim/src/index";
import { Runner } from "../lib/arm-agent/src/runner";
import { runClaude, type ClaudeClient } from "../lib/arm-agent/src/claude";

type Request = Parameters<ClaudeClient["messages"]["create"]>[0];
type Response = Awaited<ReturnType<ClaudeClient["messages"]["create"]>>;
type Messages = Request["messages"];
const tool = (id: string, name: string, input: Record<string, unknown> = {}): Response["content"][number] =>
  ({ type: "tool_use", id, name, input });
const response = (content: Response["content"], stop_reason: Response["stop_reason"] = "tool_use"): Response => ({ content, stop_reason });
const finish = () => tool("finish", "finish", { status: "done", summary: "Verified completion." });

function fakeClient(responses: Response[]) {
  const requests: Request[] = [];
  const client: ClaudeClient = {
    messages: {
      async create(params) {
        // Snapshot before subsequent transcript appends, exactly as an HTTP request would.
        requests.push(structuredClone(params));
        const next = responses.shift();
        if (!next) throw new Error("Unexpected Anthropic request.");
        return next;
      },
    },
  };
  return { client, requests };
}
function results(messages: Messages, assistantIndex: number) {
  const next = messages[assistantIndex + 1];
  expect(next?.role).toBe("user");
  if (!next || !Array.isArray(next.content)) throw new Error("Missing tool results");
  return next.content.filter(block => block.type === "tool_result");
}
function expectAllIdsMatched(messages: Messages) {
  messages.forEach((message, index) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    const ids = message.content.filter(block => block.type === "tool_use").map(block => block.id);
    if (!ids.length) return;
    expect(results(messages, index).map(block => block.tool_use_id)).toEqual(ids);
  });
}
function runner() { return new Runner(createScene(), { mode: "claude" }); }

describe("Claude Messages loop contracts, fake client only (no key or network)", () => {
  it("executes tool_use and sends the actual scene result back with exact request settings", async () => {
    const fake = fakeClient([response([tool("inspect", "get_scene")]), response([finish()])]);
    const r = runner();
    const transcript = await runClaude(r, "Inspect the scene.", fake.client);
    const returned = results(fake.requests[1]!.messages, 1)[0]!;
    expect(returned.tool_use_id).toBe("inspect");
    expect(returned.is_error).toBe(false);
    expect(JSON.parse(String(returned.content)).scene.blocks).toHaveLength(5);
    expect(r.status).toBe("done");
    expect(fake.requests[0]).toMatchObject({
      model: "claude-opus-5-5", max_tokens: 16000,
      thinking: { type: "adaptive" }, output_config: { effort: "medium" }, tool_choice: { type: "auto" },
    });
    for (const definition of fake.requests[0]!.tools!) {
      expect(definition).toMatchObject({ strict: true, input_schema: { additionalProperties: false } });
    }
    expectAllIdsMatched(transcript);
  });

  it.each([
    ["refusal", "refused"],
    ["max_tokens", "failed"],
  ] as const)("%s ends as %s without executing response tools", async (reason, expected) => {
    const fake = fakeClient([response([tool("partial", "move_to", { x: .36, z: .24 }), finish()], reason)]);
    const r = runner(), initial = structuredClone(r.scene);
    const transcript = await runClaude(r, "Move.", fake.client);
    expect(r.status).toBe(expected);
    expect(r.scene).toEqual(initial);
    expect(r.events.filter(e => e.type === "tool_call").map(e => e.tool)).toEqual(["finish"]);
    expect(results(transcript, 1).every(block => block.is_error)).toBe(true);
    expectAllIdsMatched(transcript);
    expect(fake.requests).toHaveLength(1);
  });

  it("feeds a rejection back as is_error, skips the rest of that batch and recovers to done", async () => {
    const fake = fakeClient([
      response([tool("inspect", "get_scene")]),
      response([tool("bad", "move_to", { x: .90, z: .10 }), tool("stale-grip", "grip"), tool("stale-finish", "finish", { status: "done", summary: "Must not execute." })]),
      response([tool("safe", "move_to", { x: .36, z: .24 })]),
      response([finish()]),
    ]);
    const r = runner(), initial = structuredClone(r.scene);
    const rejectedScenes: unknown[] = [];
    r.options.emit = event => { if (event.type === "safety_rejection") rejectedScenes.push(structuredClone(r.scene)); };
    const transcript = await runClaude(r, "Move safely.", fake.client);
    const errors = results(fake.requests[2]!.messages, 3);
    expect(errors.map(block => block.tool_use_id)).toEqual(["bad", "stale-grip", "stale-finish"]);
    expect(errors.every(block => block.is_error === true)).toBe(true);
    expect(JSON.parse(String(errors[0]!.content))).toMatchObject({ ok: false, code: "KEEP_OUT" });
    expect(JSON.parse(String(errors[1]!.content))).toMatchObject({ skipped: true });
    expect(rejectedScenes).toEqual([initial]);
    expect(r.status).toBe("done");
    expect(r.scene.arm.position).toEqual({ x: .36, z: .24 });
    expect(r.safetyRejections).toBe(1);
    expect(r.events.some(e => e.type === "tool_call" && e.tool === "grip")).toBe(false);
    expectAllIdsMatched(transcript);
  });

  it("fails on the third rejection and pairs all remaining IDs without more requests", async () => {
    const fake = fakeClient([
      response([tool("inspect", "get_scene")]),
      ...[1, 2, 3].map(n => response([tool(`reject-${n}`, "move_to", { x: 100, z: 100 }), tool(`skip-${n}`, "home")])),
    ]);
    const r = runner(), initial = structuredClone(r.scene);
    const transcript = await runClaude(r, "Try an unreachable move.", fake.client);
    expect(r.status).toBe("failed");
    expect(r.summary).toContain("Three safety rejections");
    expect(r.safetyRejections).toBe(3);
    expect(r.scene).toEqual(initial);
    expect(fake.requests).toHaveLength(4);
    expect(r.events.filter(e => e.type === "tool_call" && e.tool === "home")).toHaveLength(0);
    expectAllIdsMatched(transcript);
  });

  it("pairs every ID in a successful multi-tool response, including tools after finish", async () => {
    const fake = fakeClient([response([
      tool("a", "get_scene"), tool("b", "move_to", { x: .36, z: .24 }),
      tool("c", "get_scene"), finish(), tool("after-finish", "home"),
    ])]);
    const r = runner();
    const transcript = await runClaude(r, "Move.", fake.client);
    expect(r.status).toBe("done");
    expectAllIdsMatched(transcript);
    expect(results(transcript, 1).at(-1)).toMatchObject({ tool_use_id: "after-finish", is_error: true });
    expect(r.scene.arm.position).toEqual({ x: .36, z: .24 });
  });

  it("rejects malformed arguments without changing the scene and allows correction", async () => {
    const fake = fakeClient([
      response([tool("inspect", "get_scene")]),
      response([tool("invalid", "move_to", { x: "invalid", z: .24, speed: 99 })]),
      response([finish()]),
    ]);
    const r = runner(), initial = structuredClone(r.scene);
    const transcript = await runClaude(r, "Move.", fake.client);
    expect(r.scene).toEqual(initial);
    expect(r.status).toBe("done");
    expect(results(fake.requests[2]!.messages, 3)[0]).toMatchObject({ tool_use_id: "invalid", is_error: true });
    expectAllIdsMatched(transcript);
  });

  it("pairs all IDs even when a tool budget prevents execution", async () => {
    const fake = fakeClient([response([tool("inspect", "get_scene"), tool("budget", "home"), tool("skipped", "grip")])]);
    const r = runner(); r.options.maxSteps = 1;
    const transcript = await runClaude(r, "Move.", fake.client);
    expect(r.status).toBe("failed");
    expect(r.summary).toContain("budget");
    expectAllIdsMatched(transcript);
  });
});
