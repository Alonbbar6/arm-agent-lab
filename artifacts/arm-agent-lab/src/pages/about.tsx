const SECTIONS: [string, string][] = [
  ['Simulation', 'A pure TypeScript package (@workspace/arm-sim) models a planar 3-link arm on a pedestal at (0, 0.12) with links of 0.42, 0.38 and 0.12 m, a parallel gripper, blocks with mass and support relations, five slots, and a keep-out zone. Kinematics, speed (0.5 m/s) and payload (0.6 kg) limits are enforced in the same code the server and browser share.'],
  ['Planner', 'Each run is driven either by a deterministic mock planner or by Claude using tool calls. The agent only acts through tools; every call is validated by a safety layer before the simulator executes it. Only public notes are shown, never hidden reasoning.'],
  ['Streaming', 'POST /api/lab/runs returns a run id. The browser opens an EventSource on /api/lab/runs/:id/events; events carry sequence ids so a dropped connection resumes and replays without duplicates. The stream closes on the finished event, which reports done, refused or failed.'],
  ['Rendering', 'The workcell is drawn with Canvas 2D as a side view. Scene events include a duration; the renderer moves the gripper tip along a straight line and solves inverse kinematics every animation frame, so motion matches what a Cartesian controller would do.'],
  ['Evaluation', 'POST /api/lab/eval runs 16 fixed tasks against fresh scenes and reports pass rate, goal checks, step and tool counts, safety rejections, grasp retries and wall time. Results are computed on demand.'],
];

export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
      <p className="font-mono text-xs text-primary">ARCHITECTURE</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">How the lab is wired</h1>
      <div className="mt-8 divide-y border-y">
        {SECTIONS.map(([h, b], i) => (
          <section key={h} className="grid md:grid-cols-[160px_1fr] gap-2 py-5">
            <h2 className="font-mono text-sm"><span className="text-muted-foreground">0{i + 1} </span>{h}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{b}</p>
          </section>
        ))}
      </div>
      <pre className="mt-8 overflow-x-auto rounded-lg border bg-card p-4 font-mono text-xs text-muted-foreground">{`browser ── POST /runs ──> api-server ── planner (mock | claude)
   ^                          │            │ tool_call
   │   SSE LabEvent stream    │            v
   └──────────────────────────┴──── safety check ── arm-sim step`}</pre>
    </div>
  );
}
