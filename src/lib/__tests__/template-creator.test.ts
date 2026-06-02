import { describe, it, expect } from "vitest";
import { extractVariables, renderTemplatePreview, buildSample, buildVariableTree, type VarNode } from "../template-creator";

// A realistic snippet mirroring the converter's images-background2md.txt shape.
const TEMPLATE = `---
{#if resource.tags}
tags:
{#for tag in resource.tags}- {tag}
{/for}{/if}
---
# {resource.name}
*Source: {resource.source}*
{#if resource.hasImages}{resource.showPortraitImage}{/if}
{#if resource.prerequisite}***Prerequisites*** {resource.prerequisite}{/if}
{resource.text}`;

describe("extractVariables", () => {
  it("finds the resource.* references actually used", () => {
    const v = extractVariables(TEMPLATE);
    expect(v).toContain("resource.name");
    expect(v).toContain("resource.source");
    expect(v).toContain("resource.tags");
    expect(v).toContain("resource.hasImages");
    expect(v).toContain("resource.showPortraitImage");
    expect(v).toContain("resource.text");
  });
  it("dedupes and sorts", () => {
    expect(extractVariables("{resource.b} {resource.a} {resource.b}")).toEqual([
      "resource.a", "resource.b",
    ]);
  });
  it("drops trailing dots", () => {
    expect(extractVariables("{resource.name.}")).toEqual(["resource.name"]);
  });
});

describe("renderTemplatePreview", () => {
  const s = buildSample();
  it("substitutes scalar variables", () => {
    expect(renderTemplatePreview("# {resource.name}", s)).toBe("# Example Entry");
  });
  it("takes the true branch of #if", () => {
    expect(renderTemplatePreview("{#if resource.x}kept{/if}", s)).toBe("kept");
  });
  it("drops the #else branch", () => {
    expect(renderTemplatePreview("{#if resource.x}A{#else}B{/if}", s)).toBe("A");
  });
  it("expands #for loops with the item label", () => {
    expect(renderTemplatePreview("{#for tag in resource.tags}- {tag}\n{/for}", s))
      .toBe("- sample-one\n- sample-two\n");
  });
  it("expands #each loops using {it}", () => {
    expect(renderTemplatePreview("{#each resource.actions}{it.name} {/each}", s))
      .toBe("Sample name Sample name ");
  });
  it("renders the full sample template without leaving control tags", () => {
    const out = renderTemplatePreview(TEMPLATE, s);
    expect(out).toContain("# Example Entry");
    expect(out).toContain("*Source: PHB*");
    expect(out).not.toContain("{#");
    expect(out).not.toContain("{/");
  });
});

// Mirrors the structures in the real monster2md-scores.txt template.
const MONSTER = `# {resource.name}
*Source: {resource.source}*
title: {resource.name}{#if resource.token}
![{resource.token.title}]({resource.token.vaultPath}#token){/if}
- STR: {resource.scores.str} {resource.scores.strMod}
- DEX: {resource.scores.dex} {resource.scores.dexMod}
|{resource.scores}|
- **Gear** {resource.gear.join(", ")}
{#each resource.aliases}
- {it}
{/each}
{#if resource.trait}{#for trait in resource.trait}
{#if trait.name}***{trait.name}.*** {/if}{trait.desc}
{/for}{/if}
{#if resource.action}{#for action in resource.action}
{#if action.name}***{action.name}.*** {/if}{action.desc}
{/for}{/if}`;

function find(nodes: VarNode[], label: string): VarNode | undefined {
  for (const n of nodes) { if (n.label === label) return n; if (n.children) { const f = find(n.children, label); if (f) return f; } }
  return undefined;
}

describe("buildVariableTree", () => {
  const tree = buildVariableTree([MONSTER]);
  it("exposes top-level scalars", () => {
    expect(find(tree, "name")?.kind).toBe("scalar");
    expect(find(tree, "name")?.insert).toBe("{resource.name}");
  });
  it("nests object sub-fields (scores.dexMod)", () => {
    const scores = find(tree, "scores");
    expect(scores?.kind).toBe("object");
    const dexMod = scores?.children?.find((c) => c.label === "dexMod");
    expect(dexMod?.insert).toBe("{resource.scores.dexMod}");
  });
  it("keeps a bare-used object insertable as a whole block", () => {
    const scores = find(tree, "scores");
    expect(scores?.insert).toBe("{resource.scores}");      // {resource.scores} used directly
    expect((scores?.children?.length ?? 0)).toBeGreaterThan(0); // and still expandable
  });
  it("surfaces arrays as list nodes with their item fields", () => {
    const action = find(tree, "action");
    expect(action?.kind).toBe("list");
    const fields = action?.children?.map((c) => c.label).sort();
    expect(fields).toEqual(["desc", "name"]);
    expect(action?.children?.find((c) => c.label === "name")?.insert).toBe("{action.name}");
    expect(action?.insert).toContain("{#for action in resource.action}");
  });
  it("handles #each scalar-item arrays (aliases)", () => {
    const aliases = find(tree, "aliases");
    expect(aliases?.kind).toBe("list");
    expect(aliases?.children?.[0].insert).toBe("{it}");
  });
  it("trims trailing method calls (gear, not gear.join)", () => {
    expect(find(tree, "gear")?.insert).toBe("{resource.gear}");
    expect(find(tree, "join")).toBeUndefined();
  });
  it("does not list an array base as a scalar too (action only once)", () => {
    expect(find(tree, "action")?.kind).toBe("list");
  });
});
