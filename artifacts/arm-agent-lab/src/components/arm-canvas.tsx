import { useEffect, useRef } from 'react';
import { forwardKinematics, inverseKinematics, type Point, type Scene } from '@workspace/arm-sim';

const X0 = -0.25, X1 = 1.05, Z0 = -0.12, Z1 = 0.85;
const ASPECT = (X1 - X0) / (Z1 - Z0);

type Frame = { scene: Scene; joints: number[]; tip: Point; blocks: Map<string, { x: number; z: number }> };
type Anim = { from: Frame; to: Scene; start: number; dur: number };

const COLORS: Record<string, string> = {
  red: '#e0574f', blue: '#4f8fe0', green: '#4fb889', yellow: '#e3b341', orange: '#e48a3c', purple: '#9a7bd6',
};
const colorOf = (c: string) => COLORS[c.toLowerCase()] ?? c;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function frameOf(scene: Scene): Frame {
  const pts = forwardKinematics(scene.arm.joints);
  return {
    scene,
    joints: scene.arm.joints,
    tip: pts[pts.length - 1] ?? scene.arm.position,
    blocks: new Map(scene.blocks.map((b) => [b.id, { x: b.x, z: b.z }])),
  };
}

export function ArmCanvas({
  scene, durationMs, sceneKey, onAnimating,
}: { scene: Scene | null; durationMs: number; sceneKey: number; onAnimating?: (busy: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = useRef<Frame | null>(null);
  const queue = useRef<{ scene: Scene; dur: number }[]>([]);
  const anim = useRef<Anim | null>(null);
  const busyCb = useRef(onAnimating);
  busyCb.current = onAnimating;

  useEffect(() => {
    if (!scene) return;
    if (!current.current || durationMs <= 0) {
      queue.current = [];
      anim.current = null;
      current.current = frameOf(scene);
    } else queue.current.push({ scene, dur: Math.min(durationMs, 4000) });
  }, [scene, durationMs, sceneKey]);

  useEffect(() => {
    let raf = 0;
    let wasBusy = false;
    const draw = (now: number) => {
      const cv = canvasRef.current, wrap = wrapRef.current;
      if (cv && wrap) {
        const w = wrap.clientWidth, h = Math.round(w / ASPECT), dpr = window.devicePixelRatio || 1;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
          cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
          cv.style.height = `${h}px`;
        }
        if (!anim.current && queue.current.length && current.current) {
          const n = queue.current.shift()!;
          anim.current = { from: current.current, to: n.scene, start: now, dur: n.dur };
        }
        let frame = current.current;
        if (anim.current) {
          const a = anim.current;
          const t = Math.min(1, (now - a.start) / a.dur);
          // Linear timing matches the simulator's maximum end-effector speed.
          const k = t;
          const target = frameOf(a.to);
          const tip = { x: lerp(a.from.tip.x, target.tip.x, k), z: lerp(a.from.tip.z, target.tip.z, k) };
          const ik = inverseKinematics(tip);
          const joints = ik ?? a.from.joints.map((j, i) => lerp(j, target.joints[i] ?? j, k));
          const pts = forwardKinematics(joints);
          const realTip = pts[pts.length - 1] ?? tip;
          const held = a.to.arm.heldBlock ?? a.from.scene.arm.heldBlock;
          const blocks = new Map<string, { x: number; z: number }>();
          for (const b of a.to.blocks) {
            const f = a.from.blocks.get(b.id) ?? b;
            if (held === b.id && a.to.arm.heldBlock && a.from.scene.arm.heldBlock === b.id)
              blocks.set(b.id, { x: realTip.x, z: realTip.z - b.size / 2 });
            else blocks.set(b.id, { x: lerp(f.x, b.x, k), z: lerp(f.z, b.z, k) });
          }
          const gripOpen = t < 0.5 ? a.from.scene.arm.gripperOpen : a.to.arm.gripperOpen;
          frame = { scene: { ...a.to, arm: { ...a.to.arm, gripperOpen: gripOpen } }, joints, tip: realTip, blocks };
          if (t >= 1) { current.current = target; anim.current = null; frame = target; }
        }
        const busy = !!anim.current || queue.current.length > 0;
        if (busy !== wasBusy) { wasBusy = busy; busyCb.current?.(busy); }
        const ctx = cv.getContext('2d');
        if (ctx) render(ctx, cv.width, cv.height, frame);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        className="block w-full rounded-md"
        role="img"
        aria-label="Side view of the robot arm workcell"
        data-testid="canvas-arm"
      />
    </div>
  );
}

function render(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame | null) {
  const dark = document.documentElement.classList.contains('dark');
  const s = W / (X1 - X0);
  const px = (x: number) => (x - X0) * s;
  const pz = (z: number) => H - (z - Z0) * s;
  const ink = dark ? '#c9d3df' : '#1f2a37';
  const faint = dark ? 'rgba(160,180,200,0.10)' : 'rgba(40,60,90,0.08)';
  const dim = dark ? 'rgba(160,180,200,0.45)' : 'rgba(40,60,90,0.5)';
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = dark ? '#0d1218' : '#f3f6f9';
  ctx.fillRect(0, 0, W, H);

  // grid every 5cm
  ctx.lineWidth = 1;
  ctx.strokeStyle = faint;
  for (let x = -0.25; x <= 1.05 + 1e-6; x += 0.05) { ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), H); ctx.stroke(); }
  for (let z = -0.1; z <= 0.85 + 1e-6; z += 0.05) { ctx.beginPath(); ctx.moveTo(0, pz(z)); ctx.lineTo(W, pz(z)); ctx.stroke(); }
  ctx.font = `${Math.max(9, 10 * (W / 900))}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = dim;
  for (let x = 0; x <= 1.0001; x += 0.2) ctx.fillText(`${x.toFixed(1)}`, px(x) + 3, H - 4);
  for (let z = 0.2; z <= 0.8001; z += 0.2) ctx.fillText(`z ${z.toFixed(1)}`, 4, pz(z) - 3);

  // table
  ctx.fillStyle = dark ? '#18212b' : '#dfe5ec';
  ctx.fillRect(0, pz(0), W, H - pz(0));
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, pz(0)); ctx.lineTo(W, pz(0)); ctx.stroke();

  if (!f) return;
  const sc = f.scene;

  // keep-out
  const k = sc.keepOut;
  const kx = px(k.xMin), kw = px(k.xMax) - kx, ky = pz(k.zMax), kh = pz(k.zMin) - ky;
  ctx.save();
  ctx.beginPath(); ctx.rect(kx, ky, kw, kh); ctx.clip();
  ctx.fillStyle = 'rgba(224,87,79,0.10)'; ctx.fillRect(kx, ky, kw, kh);
  ctx.strokeStyle = 'rgba(224,87,79,0.55)'; ctx.lineWidth = 1.5;
  for (let d = -kh; d < kw + kh; d += 10) { ctx.beginPath(); ctx.moveTo(kx + d, ky + kh); ctx.lineTo(kx + d + kh, ky); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = '#e0574f'; ctx.setLineDash([5, 4]); ctx.strokeRect(kx, ky, kw, kh); ctx.setLineDash([]);
  ctx.fillStyle = '#e0574f'; ctx.fillText('KEEP-OUT', kx + 4, ky - 5);

  // slots
  for (const slot of sc.slots) {
    const x = px(slot.x);
    ctx.strokeStyle = dark ? '#e3a33d' : '#b7791f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 0.045 * s, pz(0) + 3); ctx.lineTo(x + 0.045 * s, pz(0) + 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, pz(0) + 1); ctx.lineTo(x, pz(0) + 8); ctx.stroke();
    ctx.fillStyle = dim; ctx.textAlign = 'center';
    ctx.fillText(`S${slot.id}`, x, pz(0) + 22);
    ctx.textAlign = 'left';
  }

  // blocks
  const sorted = [...sc.blocks].sort((a, b) => (f.blocks.get(a.id)?.z ?? a.z) - (f.blocks.get(b.id)?.z ?? b.z));
  for (const b of sorted) {
    const p = f.blocks.get(b.id) ?? { x: b.x, z: b.z };
    const bx = px(p.x - b.size / 2), by = pz(p.z + b.size), bs = b.size * s;
    ctx.fillStyle = colorOf(b.color);
    ctx.fillRect(bx, by, bs, bs);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(bx, by, bs, Math.max(2, bs * 0.12));
    ctx.fillStyle = '#0b0f14'; ctx.textAlign = 'center';
    ctx.font = `600 ${Math.max(9, bs * 0.28)}px "IBM Plex Mono", monospace`;
    ctx.fillText(b.id, bx + bs / 2, by + bs / 2 + bs * 0.1);
    ctx.textAlign = 'left';
    ctx.font = `${Math.max(9, 10 * (W / 900))}px "IBM Plex Mono", monospace`;
  }

  // arm
  const pts = forwardKinematics(f.joints);
  const base = pts[0];
  ctx.fillStyle = dark ? '#2a3542' : '#c3ccd6';
  ctx.fillRect(px(base.x) - 0.06 * s, pz(base.z), 0.12 * s, pz(0) - pz(base.z));
  ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(px(base.x) - 0.06 * s, pz(base.z), 0.12 * s, pz(0) - pz(base.z));
  const widths = [0.05, 0.038, 0.022];
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.strokeStyle = i === 2 ? (dark ? '#8fa1b5' : '#5b6b7d') : (dark ? '#e3a33d' : '#d08a1e');
    ctx.lineWidth = widths[i] * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px(pts[i].x), pz(pts[i].z)); ctx.lineTo(px(pts[i + 1].x), pz(pts[i + 1].z)); ctx.stroke();
  }
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.fillStyle = dark ? '#0d1218' : '#f3f6f9'; ctx.strokeStyle = ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px(pts[i].x), pz(pts[i].z), 0.016 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // parallel gripper at tip, oriented along last link
  const a = pts[pts.length - 2], t = pts[pts.length - 1];
  const ang = Math.atan2(-(t.z - a.z), t.x - a.x);
  const heldSize = sc.blocks.find((b) => b.id === sc.arm.heldBlock)?.size ?? 0.05;
  const half = sc.arm.gripperOpen ? 0.045 : heldSize / 2 + 0.006;
  ctx.save();
  ctx.translate(px(t.x), pz(t.z)); ctx.rotate(ang);
  ctx.fillStyle = ink;
  ctx.fillRect(-0.03 * s, -(half + 0.012) * s, 0.012 * s, (half + 0.012) * 2 * s);
  ctx.fillRect(-0.03 * s, -(half + 0.012) * s, 0.06 * s, 0.01 * s);
  ctx.fillRect(-0.03 * s, (half + 0.002) * s, 0.06 * s, 0.01 * s);
  ctx.restore();
  // tip crosshair
  ctx.strokeStyle = '#4fb8a9'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(px(t.x), pz(t.z), 4, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#4fb8a9';
  ctx.fillText(`(${t.x.toFixed(3)}, ${t.z.toFixed(3)})`, px(t.x) + 8, pz(t.z) - 8);
}
