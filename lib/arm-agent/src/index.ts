import type { Scene } from "@workspace/arm-sim";
import { Runner, type RunOptions } from "./runner";
import { runMock } from "./mock";
import { runClaude } from "./claude";
export * from "./runner";
export { DEFAULT_MODEL } from "./claude";
export async function runAgent(scene: Scene, instruction: string, options: RunOptions): Promise<Runner> {
  if (options.mode === "unguarded") throw new Error("Unguarded mode is only available through the evaluation suite.");
  const runner = new Runner(scene, options);
  try { await (options.mode === "claude" ? runClaude(runner, instruction) : runMock(runner, instruction)); }
  catch (error) { if (!runner.status) await runner.finish("failed", options.signal?.aborted ? "Stopped by user." : error instanceof Error ? error.message.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]") : "Agent execution failed."); }
  return runner;
}
