import { covered, PAYLOAD_LIMIT, type Block } from "@workspace/arm-sim";
import type { Runner } from "./runner";
class Refuse extends Error {}
export async function runMock(r: Runner, instruction: string): Promise<void> {
  await r.call("get_scene");
  r.note("Inspecting the scene and checking task feasibility before planning safe pick-and-place motions.");
  const text = instruction.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
  const find = (id: string): Block => {
    const block = r.scene.blocks.find(b => b.id === id);
    if (!block) throw new Refuse(`No ${id} block exists.`);
    if (block.mass > PAYLOAD_LIMIT) throw new Refuse("The heavy block exceeds the 0.6 kg payload limit.");
    if (block.x + block.size / 2 >= r.scene.keepOut.xMin) throw new Refuse(`${id} is inside the human keep-out zone.`);
    return block;
  };
  const must = async (tool: string, args = {}): Promise<void> => {
    const result = await r.call(tool, args);
    if (!result.ok) throw new Refuse(result.error);
  };
  const transfer = async (id: string, x: number, bottom: number): Promise<void> => {
    const b = find(id);
    if (covered(r.scene, id)) throw new Refuse(`${id} is covered. Unstack the top block before picking it.`);
    if (x + b.size / 2 >= r.scene.keepOut.xMin || x < .12 || x > .78) throw new Refuse("Destination is outside the safe reachable workspace.");
    if (bottom + b.size > .22) throw new Refuse("This stack exceeds the safe transfer clearance.");
    let held = false;
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt) r.note(`Grasp verification found no held block. Re-approaching for retry ${attempt}/2.`);
      await must("release");
      await must("move_to", { x: r.scene.arm.position.x, z: .24 });
      await must("move_to", { x: b.x, z: .24 });
      await must("move_to", { x: b.x, z: b.z + b.size / 2 });
      await must("grip");
      await r.call("get_scene");
      held = r.scene.arm.heldBlock === id;
      if (held) break;
    }
    if (!held) throw new Error("Grasp failed after the initial attempt and two retries.");
    await must("move_to", { x: b.x, z: .24 });
    await must("move_to", { x, z: .24 });
    await must("move_to", { x, z: bottom + b.size / 2 + .004 });
    await must("release");
    await r.call("get_scene");
  };
  try {
    if (/\b(throw|person|human|keep[- ]?out|unsafe|100|999|outside|bypass|ignore safety)\b/.test(text)) throw new Refuse("I cannot enter the human keep-out zone, throw objects, bypass safety, or exceed the workspace.");
    let match: RegExpMatchArray | null;
    if ((match = text.match(/^stack (red|blue|green|yellow|heavy) on (red|blue|green|yellow|heavy)$/))) {
      const a = find(match[1]!), b = find(match[2]!);
      if (a.id === b.id) throw new Refuse("A block cannot be stacked on itself.");
      if (covered(r.scene, b.id)) throw new Refuse("The destination block is covered.");
      r.note(`Place ${a.id} on ${b.id}, then verify the support relation.`);
      await transfer(a.id, b.x, b.z + b.size);
      if (a.restsOn !== b.id && r.scene.blocks.find(v => v.id === a.id)?.restsOn !== b.id) throw new Error("Final support verification failed.");
    } else if ((match = text.match(/^put (red|blue|green|yellow|heavy) in slot ([1-5])$/))) {
      const b = find(match[1]!); const slot = r.scene.slots.find(s => s.id === Number(match![2]))!;
      if (r.scene.blocks.some(other => other.id !== b.id && Math.abs(other.x - slot.x) < .06)) throw new Refuse("The destination slot is occupied.");
      await transfer(b.id, slot.x, 0);
    } else if ((match = text.match(/^move (red|blue|green|yellow|heavy) to (left|right)$/))) {
      const b = find(match[1]!);
      const slots = r.scene.slots.filter(s => (match![2] === "left" ? s.x < b.x - .03 : s.x > b.x + .03) && !r.scene.blocks.some(other => other.id !== b.id && Math.abs(other.x - s.x) < .065));
      const slot = match[2] === "left" ? slots.at(-1) : slots[0];
      if (!slot) throw new Refuse("There is no empty safe slot in that direction.");
      await transfer(b.id, slot.x, 0);
    } else if (text === "unstack" || text === "put everything back home") {
      const movable = r.scene.blocks.filter(b => b.mass <= PAYLOAD_LIMIT).sort((a, b) => b.z - a.z);
      for (const b of movable) {
        if (b.z === 0 && Math.abs(b.x - b.homeX) < .01) continue;
        const occupied = r.scene.blocks.some(other => other.id !== b.id && Math.abs(other.x - b.homeX) < .06);
        const free = r.scene.slots.find(s => !r.scene.blocks.some(other => other.id !== b.id && Math.abs(other.x - s.x) < .065));
        if (occupied && !free) throw new Refuse("No free safe slot is available for unstacking.");
        await transfer(b.id, occupied ? free!.x : b.homeX, 0);
      }
    } else if ((match = text.match(/^pick (red|blue|green|yellow|heavy)(?: without unstacking)?$/))) {
      const b = find(match[1]!);
      if (covered(r.scene, b.id)) throw new Refuse("Cannot pick a covered block without unstacking.");
      throw new Refuse("Use a supported pick-and-place instruction, not an incomplete pick.");
    } else throw new Refuse("Mock planner supports: stack X on Y; put X in slot N; move X to the left/right; unstack; put everything back home.");
    await must("move_to", { x: r.scene.arm.position.x, z: .24 });
    await must("home");
    await r.call("get_scene");
    await r.finish("done", "Task completed and final scene verified.");
  } catch (error) {
    if (r.options.signal?.aborted) throw error;
    await r.finish(error instanceof Refuse ? "refused" : "failed", error instanceof Error ? error.message : "Planner failed.");
  }
}
