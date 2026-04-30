// Run with: npx tsx scripts/smoke-openai.ts
// Verifies every model in MODELS responds to a trivial chat completion.
// Prints PASS/FAIL per model and exits 0 only if all pass.

import { openai, MODELS } from "../lib/openai";

async function probe(model: string): Promise<{ ok: boolean; note: string }> {
  try {
    const res = await openai().chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
    });
    const text = res.choices[0]?.message?.content?.trim() ?? "";
    return { ok: text.length > 0, note: text || "(empty)" };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, note: msg };
  }
}

async function main() {
  console.log("Probing models:", MODELS.join(", "));
  let allOk = true;
  for (const m of MODELS) {
    process.stdout.write(`- ${m} ... `);
    const { ok, note } = await probe(m);
    console.log(ok ? `PASS (${note.slice(0, 40)})` : `FAIL (${note.slice(0, 120)})`);
    if (!ok) allOk = false;
  }
  process.exit(allOk ? 0 : 1);
}

main();
