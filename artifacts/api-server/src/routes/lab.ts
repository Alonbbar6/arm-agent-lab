import { Router, type IRouter, type Response } from "express";
import { randomUUID } from "node:crypto";
import { createScene, validateScene, SCENARIOS, type LabEvent, type Mode } from "@workspace/arm-sim";
import { runAgent, DEFAULT_MODEL } from "@workspace/arm-agent";
import { runEval } from "@workspace/arm-agent/eval";
import { CreateLabSceneBody, CreateLabRunBody, RunLabEvalBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";
type Run = { events: LabEvent[]; controller: AbortController; listeners: Set<Response>; complete: boolean; created: number };
const runs = new Map<string, Run>();
const router: IRouter = Router();
const effectiveMode = (mode: Mode): Mode => mode === "claude" && process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
const send = (res: Response, event: LabEvent) => res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
// Runs are private-development, in-memory and bounded. No database or key reaches the client.
router.get("/lab/config", (_req, res) => {
  res.json({ claudeAvailable: Boolean(process.env.ANTHROPIC_API_KEY), model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, scenarios: SCENARIOS });
});
router.post("/lab/scene", (req, res) => {
  const parsed = CreateLabSceneBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  res.json(createScene(parsed.data.scenario, parsed.data.seed));
});
router.post("/lab/runs", (req, res) => {
  const parsed = CreateLabRunBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let scene;
  try { scene = validateScene(parsed.data.scene); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid scene" }); return; }
  for (const [id, run] of runs) if (run.complete && Date.now() - run.created > 15 * 60_000) runs.delete(id);
  if ([...runs.values()].filter(r => !r.complete).length >= 4) { res.status(429).json({ error: "Four runs are active. Stop one before starting another." }); return; }
  while (runs.size >= 50) {
    const oldest = [...runs].find(([, r]) => r.complete);
    if (!oldest) break;
    runs.delete(oldest[0]);
  }
  const id = randomUUID(), mode = effectiveMode(parsed.data.mode);
  const run: Run = { events: [], controller: new AbortController(), listeners: new Set(), complete: false, created: Date.now() };
  runs.set(id, run);
  res.json({ id, mode });
  const timeout = setTimeout(() => run.controller.abort(), 5 * 60_000);
  void runAgent(scene, parsed.data.instruction, {
    mode, realtime: true, signal: run.controller.signal,
    emit: event => {
      run.events.push(event);
      if (event.type === "safety_rejection") logger.warn({ runId: id, tool: event.tool, rejection: event.result }, "Arm action rejected");
      for (const listener of run.listeners) send(listener, event);
      if (event.type === "finished") {
        run.complete = true;
        for (const listener of run.listeners) listener.end();
        run.listeners.clear();
      }
    },
  }).finally(() => { clearTimeout(timeout); run.complete = true; });
});
router.get("/lab/runs/:id/events", (req, res) => {
  const run = runs.get(String(req.params.id));
  if (!run) { res.status(404).json({ error: "Run expired or not found." }); return; }
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const last = Number(req.headers["last-event-id"] ?? 0);
  for (const event of run.events) if (event.seq > (Number.isFinite(last) ? last : 0)) send(res, event);
  if (run.complete) { res.end(); return; }
  run.listeners.add(res);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
  req.on("close", () => { clearInterval(heartbeat); run.listeners.delete(res); });
});
router.post("/lab/runs/:id/stop", (req, res) => {
  const run = runs.get(String(req.params.id));
  if (!run) { res.status(404).json({ error: "Run not found." }); return; }
  run.controller.abort(); res.json({ ok: true });
});
let evaluating = false;
router.post("/lab/eval", async (req, res): Promise<void> => {
  const parsed = RunLabEvalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (evaluating) { res.status(429).json({ error: "An evaluation is already running." }); return; }
  evaluating = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60_000);
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  try { res.json(await runEval(parsed.data.mode === "unguarded" ? "unguarded" : effectiveMode(parsed.data.mode), controller.signal)); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Evaluation failed." }); }
  finally { clearTimeout(timeout); evaluating = false; }
});
export default router;
