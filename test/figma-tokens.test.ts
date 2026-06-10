import { deepEqual, equal } from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createTokenFiles,
  writeTokenFiles,
} from "../scripts/figma-tokens.ts";

describe("Figma variable tokens", () => {
  it("creates deterministic collection mode files", () => {
    const response = fixture();
    const reversed: any = fixture();
    reversed.meta.variableCollections = Object.fromEntries(
      Object.entries(reversed.meta.variableCollections).reverse(),
    );
    reversed.meta.variables = Object.fromEntries(
      Object.entries(reversed.meta.variables).reverse(),
    );
    reversed.meta.variableCollections.brands.variableIds.reverse();

    const files = createTokenFiles(response);
    deepEqual([...files], [...createTokenFiles(reversed)]);
    deepEqual([...files.keys()], [
      "brands/dark.json",
      "brands/light.json",
      "primitives.json",
    ]);

    const primitives = JSON.parse(files.get("primitives.json")!);
    deepEqual(primitives.primitives.color.blue.$value, {
      colorSpace: "srgb",
      components: [0.1, 0.2, 0.3],
      alpha: 0.5,
    });
    equal(primitives.primitives.color.blue.$type, "color");
    equal(primitives.primitives.font.family.inter.$type, "fontFamily");
    equal(primitives.primitives.spacing.small.$type, "number");

    const dark = JSON.parse(files.get("brands/dark.json")!);
    equal(
      dark.brands.color.action.$value,
      "{primitives.color.blue}",
    );
    equal(dark.brands.content.title.$type, "string");
    equal(dark.brands.content.title.$value, "Dark title");
    equal(dark.brands.content.visible.$type, "boolean");
    equal(dark.brands.content.visible.$value, false);
  });

  it("writes once and reports a no-op for unchanged files", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "figma-tokens-"));

    try {
      const files = createTokenFiles(fixture());
      equal(writeTokenFiles(rootDirectory, files), true);
      equal(writeTokenFiles(rootDirectory, files), false);
      deepEqual(readdirSync(join(rootDirectory, "figma")).sort(), [
        "brands",
        "primitives.json",
      ]);
      equal(
        readFileSync(
          join(rootDirectory, "figma", "brands", "dark.json"),
          "utf8",
        ),
        files.get("brands/dark.json"),
      );
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});

function fixture() {
  return {
    status: 200,
    error: false,
    meta: {
      variableCollections: {
        primitives: {
          id: "primitives",
          name: "Primitives",
          remote: false,
          modes: [{ modeId: "base", name: "Mode 1" }],
          variableIds: ["blue", "font", "spacing"],
        },
        brands: {
          id: "brands",
          name: "Brands",
          remote: false,
          modes: [
            { modeId: "light", name: "Light" },
            { modeId: "dark", name: "Dark" },
          ],
          variableIds: ["action", "title", "visible"],
        },
      },
      variables: {
        blue: {
          id: "blue",
          name: "color/blue",
          description: "Blue with transparency",
          remote: false,
          variableCollectionId: "primitives",
          resolvedType: "COLOR",
          valuesByMode: {
            base: { r: 0.1, g: 0.2, b: 0.3, a: 0.5 },
          },
        },
        font: {
          id: "font",
          name: "font/family/Inter",
          description: "",
          remote: false,
          variableCollectionId: "primitives",
          resolvedType: "STRING",
          valuesByMode: { base: "Inter" },
        },
        spacing: {
          id: "spacing",
          name: "spacing/small",
          description: "",
          remote: false,
          variableCollectionId: "primitives",
          resolvedType: "FLOAT",
          valuesByMode: { base: 8 },
        },
        action: {
          id: "action",
          name: "color/action",
          description: "",
          remote: false,
          variableCollectionId: "brands",
          resolvedType: "COLOR",
          valuesByMode: {
            light: { type: "VARIABLE_ALIAS", id: "blue" },
            dark: { type: "VARIABLE_ALIAS", id: "blue" },
          },
        },
        title: {
          id: "title",
          name: "content/title",
          description: "",
          remote: false,
          variableCollectionId: "brands",
          resolvedType: "STRING",
          valuesByMode: {
            light: "Light title",
            dark: "Dark title",
          },
        },
        visible: {
          id: "visible",
          name: "content/visible",
          description: "",
          remote: false,
          variableCollectionId: "brands",
          resolvedType: "BOOLEAN",
          valuesByMode: { light: true, dark: false },
        },
      },
    },
  };
}
