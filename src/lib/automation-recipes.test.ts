/**
 * The recipe catalogue, checked against the schema that will reject it.
 *
 * On the tested boundary because the failure is invisible until somebody clicks.
 * A recipe is written by hand here and validated by Zod at install time, in a
 * server action whose only answer is `{ success: false }`. Nothing type-checks
 * the two against each other: TypeScript agrees a string is a string, and Zod is
 * the one that knows `dueDateDays` stops at 365 and that `priority` has three
 * values and not four. A catalogue that cannot be installed looks exactly like a
 * catalogue that can, right up to the toast.
 *
 * It also holds the line between the recipes and the rule builder: a recipe whose
 * condition names a field the builder does not offer installs correctly and then
 * cannot be edited, because the field selector has nothing to select.
 */
import { describe, expect, it } from "vitest";

import { AutomationRuleFormSchema, ENTITY_FIELDS, TARGET_ENTITIES } from "@/components/crm/automation/types";

import { AUTOMATION_RECIPES, findRecipe, isPreviewable } from "./automation-recipes";

describe("every recipe", () => {
  it.each(AUTOMATION_RECIPES.map((r) => [r.id, r] as const))("%s is a rule the server will accept", (_id, recipe) => {
    const parsed = AutomationRuleFormSchema.safeParse(recipe.rule);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.errors)).toBe(true);
  });

  it.each(AUTOMATION_RECIPES.map((r) => [r.id, r] as const))("%s targets an entity that exists", (_id, recipe) => {
    expect(TARGET_ENTITIES).toContain(recipe.rule.targetEntity);
  });

  it.each(
    AUTOMATION_RECIPES.map((r) => [r.id, r] as const),
  )("%s only names fields the builder can show", (_id, recipe) => {
    const known = new Set(ENTITY_FIELDS[recipe.rule.targetEntity].map((f) => f.key));
    for (const condition of recipe.rule.conditions) {
      expect(known, `${recipe.rule.targetEntity} has no field ${condition.field}`).toContain(condition.field);
    }
  });

  it("has no two recipes under one id", () => {
    const ids = AUTOMATION_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is reachable by id", () => {
    for (const recipe of AUTOMATION_RECIPES) expect(findRecipe(recipe.id)).toBe(recipe);
    expect(findRecipe("nothing-like-this")).toBeUndefined();
  });

  it("never fires on a schedule, which does not run on Workers", () => {
    for (const recipe of AUTOMATION_RECIPES) {
      for (const trigger of recipe.rule.triggerOn) {
        expect(trigger.startsWith("scheduled:"), `${recipe.id} is scheduled`).toBe(false);
      }
    }
  });
});

describe("the preview", () => {
  it("counts state, and refuses to count a change", () => {
    // "moved to won" is not a property a deal has, so a count for it would be a
    // number about nothing.
    const onChange = AUTOMATION_RECIPES.filter((r) => r.rule.conditions.some((c) => c.operator.startsWith("changed")));
    expect(onChange.length).toBeGreaterThan(0);
    for (const recipe of onChange) expect(isPreviewable(recipe)).toBe(false);

    const onState = AUTOMATION_RECIPES.filter((r) => !r.rule.conditions.some((c) => c.operator.startsWith("changed")));
    expect(onState.length).toBeGreaterThan(0);
    for (const recipe of onState) expect(isPreviewable(recipe)).toBe(true);
  });
});
