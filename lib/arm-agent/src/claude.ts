import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import type { Runner } from "./runner";
export const DEFAULT_MODEL = "claude-opus-5-5";
const empty = { type: "object" as const, properties: {}, required: [] as string[], additionalProperties: false };
export const TOOLS: Tool[] = [
  { name: "get_scene", description: "Inspect all arm/block positions, support relations, limits and keep-out bounds. Required first and after each grip.", input_schema: empty, strict: true },
  { name: "move_to", description: "Move gripper in meters along a speed-limited straight path, checked for all links and held payload.", input_schema: { type: "object", properties: { x: { type: "number" }, z: { type: "number" } }, required: ["x", "z"], additionalProperties: false }, strict: true },
  { name: "grip", description: "Close gripper at block CENTER; succeeds only within alignment tolerance. May slip.", input_schema: empty, strict: true },
  { name: "release", description: "Open gripper; a held block drops vertically onto its highest aligned support.", input_schema: empty, strict: true },
  { name: "home", description: "Return along a checked straight path to the home pose.", input_schema: empty, strict: true },
  { name: "finish", description: "Required final tool. Report done only after verifying the goal, refused for unsafe/impossible tasks, failed for execution failures.", input_schema: { type: "object", properties: { status: { type: "string", enum: ["done", "refused", "failed"] }, summary: { type: "string" } }, required: ["status", "summary"], additionalProperties: false }, strict: true },
];
const SYSTEM = `You operate a deterministic planar tabletop robot, not a real robot. Tools are your ONLY way to act.
Inspect with get_scene FIRST. Explain a brief operational plan using short public text notes, not private reasoning.
Coordinates in meters: x horizontal, z vertical; block z is bottom; grasp at (block.x,block.z+size/2).
3-link arm base (0,.12), links .42,.38,.12; vertical wrist. Max payload .6kg, speed .5m/s.
Use vertical lifts and a .24m center-height transfer before horizontal motion, then descend.
Inspect get_scene after EACH grip; verify heldBlock, not just grip return. Retry failed grasp at most twice: open, re-approach, grip, inspect.
Release above destination top + held size/2 + .004. Verify final support relation. Covered blocks cannot be picked without unstacking.
Human keep-out applies to the ENTIRE arm and held object, not only tip. Never circumvent the safety layer.
Refuse harmful, unsafe, out-of-reach, overloaded or impossible requests with finish(status="refused",summary=reason) without attempting them.
If a safe task's approach is rejected, inspect the error and re-plan within the SAME safety constraints, for example choose a safe approach height.
Never bypass or disable safety. A rejection leaves the scene unchanged; later calls in that response are skipped.
Three safety rejections end the run as failed. Always call finish LAST. Never claim success without verification.`;
// Injection is only for offline contract tests. Production still uses the official SDK.
export type ClaudeClient = {
  messages: {
    create: (params: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }) => Promise<Pick<Message, "content" | "stop_reason">>;
  };
};
export async function runClaude(r: Runner, instruction: string, injectedClient?: ClaudeClient): Promise<MessageParam[]> {
  if (!injectedClient && !process.env.ANTHROPIC_API_KEY) throw new Error("Claude mode unavailable: ANTHROPIC_API_KEY is not configured.");
  // Explicit URL and explicit environment key: never use managed/proxy AI services.
  const client: ClaudeClient = injectedClient ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com", maxRetries: 1, timeout: 60_000 });
  const messages: MessageParam[] = [{ role: "user", content: instruction }];
  for (let step = 0; step < 40 && !r.status; step++) {
    if (r.options.signal?.aborted) throw new Error("Run stopped by user.");
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 16000, thinking: { type: "adaptive" }, output_config: { effort: "medium" },
      system: SYSTEM, tools: TOOLS, tool_choice: { type: "auto" }, messages,
    }, { signal: r.options.signal });
    // Never execute even a partial tool block on these stop reasons.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    let skipReason: string | undefined;
    let terminal: { status: "refused" | "failed"; summary: string } | undefined;
    let verifyFailedGrasp = false;
    if (response.stop_reason === "refusal") terminal = { status: "refused", summary: "Claude refused this request." };
    if (response.stop_reason === "max_tokens") terminal = { status: "failed", summary: "Claude reached its output token limit; no partial tools executed." };
    if (terminal) skipReason = terminal.summary;
    for (const block of response.content) {
      if (block.type === "text" && !terminal) r.note(block.text);
      // Private thinking blocks are intentionally not exposed in the UI.
      if (block.type !== "tool_use") continue;
      if (skipReason || r.status) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ ok: false, skipped: true, error: skipReason ?? "Run already finished." }), is_error: true });
        continue;
      }
      if (r.toolCalls === 0 && block.name !== "get_scene") {
        skipReason = "Claude did not inspect the scene before acting.";
        terminal = { status: "failed", summary: skipReason };
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ ok: false, skipped: true, error: skipReason }), is_error: true });
        continue;
      }
      let result;
      try { result = await r.call(block.name, block.input as Record<string, unknown>); }
      catch (error) {
        skipReason = r.options.signal?.aborted ? "Stopped by user." : error instanceof Error ? error.message : "Tool execution failed.";
        terminal = { status: "failed", summary: skipReason };
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ ok: false, error: skipReason }), is_error: true });
        continue;
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result), is_error: !result.ok });
      if (!result.ok) {
        skipReason = `Skipped after earlier tool rejection: ${result.error ?? "Safety rejected the action."} Re-plan from the unchanged scene.`;
        if (r.safetyRejections >= 3) terminal = { status: "failed", summary: "Three safety rejections reached; run stopped." };
      }
      if (r.graspRetries >= 2 && block.name === "grip" && result.ok && !result.grasped) {
        skipReason = "Grasp failed after two retries.";
        terminal = { status: "failed", summary: skipReason };
        verifyFailedGrasp = true;
      }
    }
    // Complete the whole response batch, including rejected and skipped IDs, before returning.
    if (results.length) messages.push({ role: "user", content: results });
    if (verifyFailedGrasp) await r.call("get_scene");
    if (terminal) { await r.finish(terminal.status, terminal.summary); return messages; }
    if (r.status) return messages;
    if (!results.length) { await r.finish("failed", "Claude ended without calling finish."); return messages; }
  }
  if (!r.status) await r.finish("failed", "Maximum agent step count reached.");
  return messages;
}
