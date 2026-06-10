import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const TOKEN_SCHEMA =
  "https://www.designtokens.org/schemas/2025.10/format.json";

type FigmaResolvedType = "BOOLEAN" | "COLOR" | "FLOAT" | "STRING";

interface FigmaMode {
  modeId: string;
  name: string;
}

interface FigmaCollection {
  id: string;
  name: string;
  remote: boolean;
  modes: FigmaMode[];
  variableIds: string[];
}

interface FigmaVariable {
  id: string;
  name: string;
  description: string;
  remote: boolean;
  resolvedType: FigmaResolvedType;
  variableCollectionId: string;
  valuesByMode: Record<string, unknown>;
}

interface ValidatedFigmaData {
  collections: FigmaCollection[];
  variables: Map<string, FigmaVariable>;
}

export type TokenFiles = Map<string, string>;

export function createTokenFiles(response: unknown): TokenFiles {
  const { collections, variables } = validateResponse(response);
  const collectionSlugs = uniqueSlugs(
    collections.map((collection) => [collection.id, collection.name]),
    "collection",
  );
  const variablePaths = createVariablePaths(
    collections,
    variables,
    collectionSlugs,
  );
  const files: TokenFiles = new Map();

  for (const collection of collections) {
    const collectionSlug = collectionSlugs.get(collection.id)!;
    const modes = uniqueSlugs(
      collection.modes.map((mode) => [mode.modeId, mode.name]),
      `mode in collection "${collection.name}"`,
    );
    const collectionVariables = [...variables.values()]
      .filter(
        (variable) => variable.variableCollectionId === collection.id,
      )
      .sort((left, right) =>
        compareStrings(
          variablePaths.get(left.id)!.join("."),
          variablePaths.get(right.id)!.join("."),
        ),
      );

    for (const mode of collection.modes) {
      const document: Record<string, unknown> = {
        $schema: TOKEN_SCHEMA,
        [collectionSlug]: {},
      };
      const root = document[collectionSlug] as Record<string, unknown>;

      for (const variable of collectionVariables) {
        const rawValue = variable.valuesByMode[mode.modeId];
        if (rawValue === undefined) {
          throw new Error(
            `Variable "${variable.name}" has no value for mode "${mode.name}"`,
          );
        }

        setToken(
          root,
          variablePaths.get(variable.id)!,
          createToken(variable, rawValue, variablePaths),
        );
      }

      const filePath =
        collection.modes.length === 1
          ? `${collectionSlug}.json`
          : `${collectionSlug}/${modes.get(mode.modeId)!}.json`;
      files.set(filePath, `${JSON.stringify(document, null, 2)}\n`);
    }
  }

  return new Map(
    [...files.entries()].sort(([left], [right]) =>
      compareStrings(left, right),
    ),
  );
}

export function writeTokenFiles(
  rootDirectory: string,
  files: TokenFiles,
): boolean {
  const outputDirectory = join(rootDirectory, "figma");

  if (directoryMatches(outputDirectory, files)) {
    return false;
  }

  const temporaryDirectory = mkdtempSync(join(rootDirectory, ".figma-sync-"));
  const generatedDirectory = join(temporaryDirectory, "figma");
  const backupDirectory = join(rootDirectory, `.figma-backup-${process.pid}`);

  try {
    mkdirSync(generatedDirectory);
    for (const [filePath, contents] of files) {
      const outputFile = join(generatedDirectory, filePath);
      mkdirSync(dirname(outputFile), { recursive: true });
      writeFileSync(outputFile, contents);
    }

    rmSync(backupDirectory, { recursive: true, force: true });
    if (existsSync(outputDirectory)) {
      renameSync(outputDirectory, backupDirectory);
    }

    try {
      renameSync(generatedDirectory, outputDirectory);
      rmSync(backupDirectory, { recursive: true, force: true });
    } catch (error) {
      if (existsSync(backupDirectory) && !existsSync(outputDirectory)) {
        renameSync(backupDirectory, outputDirectory);
      }
      throw error;
    }

    return true;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function validateResponse(response: unknown): ValidatedFigmaData {
  if (!isRecord(response) || !isRecord(response.meta)) {
    throw new Error("Figma response is missing meta data");
  }

  const rawCollections = response.meta.variableCollections;
  const rawVariables = response.meta.variables;
  if (!isRecord(rawCollections) || !isRecord(rawVariables)) {
    throw new Error("Figma response is missing collections or variables");
  }

  const allCollections = new Map<string, FigmaCollection>();
  for (const [key, value] of Object.entries(rawCollections)) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      value.id !== key ||
      typeof value.name !== "string" ||
      typeof value.remote !== "boolean" ||
      !Array.isArray(value.modes) ||
      !value.modes.every(isFigmaMode) ||
      !Array.isArray(value.variableIds) ||
      !value.variableIds.every((id) => typeof id === "string")
    ) {
      throw new Error(`Figma collection "${key}" is incomplete`);
    }
    allCollections.set(key, value as unknown as FigmaCollection);
  }

  const allVariables = new Map<string, FigmaVariable>();
  for (const [key, value] of Object.entries(rawVariables)) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      value.id !== key ||
      typeof value.name !== "string" ||
      typeof value.description !== "string" ||
      typeof value.remote !== "boolean" ||
      !isResolvedType(value.resolvedType) ||
      typeof value.variableCollectionId !== "string" ||
      !isRecord(value.valuesByMode)
    ) {
      throw new Error(`Figma variable "${key}" is incomplete`);
    }
    allVariables.set(key, value as unknown as FigmaVariable);
  }

  for (const collection of allCollections.values()) {
    for (const variableId of collection.variableIds) {
      const variable = allVariables.get(variableId);
      if (!variable) {
        throw new Error(
          `Collection "${collection.name}" references missing variable "${variableId}"`,
        );
      }
      if (variable.variableCollectionId !== collection.id) {
        throw new Error(
          `Variable "${variable.name}" is listed in the wrong collection`,
        );
      }
    }
  }

  for (const variable of allVariables.values()) {
    if (!allCollections.has(variable.variableCollectionId)) {
      throw new Error(
        `Variable "${variable.name}" references a missing collection`,
      );
    }
  }

  const collections = [...allCollections.values()]
    .filter((collection) => !collection.remote)
    .sort((left, right) => compareStrings(left.name, right.name));
  const collectionIds = new Set(
    collections.map((collection) => collection.id),
  );
  const variables = new Map(
    [...allVariables.entries()].filter(
      ([, variable]) =>
        !variable.remote && collectionIds.has(variable.variableCollectionId),
    ),
  );

  if (collections.length === 0 || variables.size === 0) {
    throw new Error("Figma response contains no local collections or variables");
  }

  for (const collection of collections) {
    if (collection.modes.length === 0) {
      throw new Error(`Collection "${collection.name}" contains no modes`);
    }

    const expectedIds = new Set(
      collection.variableIds.filter((id) => {
        const variable = allVariables.get(id);
        return variable && !variable.remote;
      }),
    );
    const actualIds = new Set(
      [...variables.values()]
        .filter(
          (variable) => variable.variableCollectionId === collection.id,
        )
        .map((variable) => variable.id),
    );

    if (!setsEqual(expectedIds, actualIds)) {
      throw new Error(
        `Collection "${collection.name}" has inconsistent variable membership`,
      );
    }
  }

  for (const variable of variables.values()) {
    for (const value of Object.values(variable.valuesByMode)) {
      const aliasId = getAliasId(value);
      if (aliasId && !variables.has(aliasId)) {
        throw new Error(
          `Variable "${variable.name}" references unavailable variable "${aliasId}"`,
        );
      }
    }
  }

  return { collections, variables };
}

function createVariablePaths(
  collections: FigmaCollection[],
  variables: Map<string, FigmaVariable>,
  collectionSlugs: Map<string, string>,
): Map<string, string[]> {
  const paths = new Map<string, string[]>();

  for (const collection of collections) {
    const usedPaths = new Map<string, string>();
    const collectionSlug = collectionSlugs.get(collection.id)!;

    for (const variable of variables.values()) {
      if (variable.variableCollectionId !== collection.id) {
        continue;
      }

      const segments = variable.name.split("/").map(slug);
      if (segments.some((segment) => segment.length === 0)) {
        throw new Error(`Variable "${variable.name}" has an empty token name`);
      }

      const tokenPath = [collectionSlug, ...segments];
      const pathKey = tokenPath.join(".");
      const existingVariable = usedPaths.get(pathKey);
      if (existingVariable) {
        throw new Error(
          `Variables "${existingVariable}" and "${variable.name}" produce the same token path`,
        );
      }

      usedPaths.set(pathKey, variable.name);
      paths.set(variable.id, tokenPath);
    }

    for (const [pathKey, variableName] of usedPaths) {
      const segments = pathKey.split(".");
      for (let index = 1; index < segments.length; index += 1) {
        const parentPath = segments.slice(0, index).join(".");
        const parentVariable = usedPaths.get(parentPath);
        if (parentVariable) {
          throw new Error(
            `Variables "${parentVariable}" and "${variableName}" produce a token/group collision`,
          );
        }
      }
    }
  }

  return paths;
}

function createToken(
  variable: FigmaVariable,
  rawValue: unknown,
  variablePaths: Map<string, string[]>,
): Record<string, unknown> {
  const token: Record<string, unknown> = {
    $value: convertValue(variable, rawValue, variablePaths),
    $type: toTokenType(variable),
  };

  if (variable.description.trim()) {
    token.$description = variable.description.trim();
  }

  return token;
}

function toTokenType(variable: FigmaVariable): string {
  switch (variable.resolvedType) {
    case "COLOR":
      return "color";
    case "FLOAT":
      return "number";
    case "STRING":
      return variable.name === "font/family" ||
        variable.name.startsWith("font/family/")
        ? "fontFamily"
        : "string";
    case "BOOLEAN":
      return "boolean";
  }
}

function convertValue(
  variable: FigmaVariable,
  rawValue: unknown,
  variablePaths: Map<string, string[]>,
): unknown {
  const aliasId = getAliasId(rawValue);
  if (aliasId) {
    const targetPath = variablePaths.get(aliasId);
    if (!targetPath) {
      throw new Error(
        `Variable "${variable.name}" references unavailable variable "${aliasId}"`,
      );
    }
    return `{${targetPath.join(".")}}`;
  }

  switch (variable.resolvedType) {
    case "BOOLEAN":
      if (typeof rawValue !== "boolean") {
        throw invalidValueError(variable);
      }
      return rawValue;
    case "FLOAT":
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
        throw invalidValueError(variable);
      }
      return rawValue;
    case "STRING":
      if (typeof rawValue !== "string") {
        throw invalidValueError(variable);
      }
      return rawValue;
    case "COLOR":
      if (
        !isRecord(rawValue) ||
        !isUnitInterval(rawValue.r) ||
        !isUnitInterval(rawValue.g) ||
        !isUnitInterval(rawValue.b) ||
        !isUnitInterval(rawValue.a)
      ) {
        throw invalidValueError(variable);
      }
      return {
        colorSpace: "srgb",
        components: [rawValue.r, rawValue.g, rawValue.b],
        alpha: rawValue.a,
      };
  }
}

function setToken(
  root: Record<string, unknown>,
  fullPath: string[],
  token: Record<string, unknown>,
): void {
  let current = root;
  const path = fullPath.slice(1);

  for (const segment of path.slice(0, -1)) {
    const existing = current[segment];
    if (existing === undefined) {
      current[segment] = {};
    } else if (!isRecord(existing) || "$value" in existing) {
      throw new Error(`Token path "${fullPath.join(".")}" collides with a token`);
    }
    current = current[segment] as Record<string, unknown>;
  }

  const tokenName = path.at(-1)!;
  if (current[tokenName] !== undefined) {
    throw new Error(`Duplicate token path "${fullPath.join(".")}"`);
  }
  current[tokenName] = token;
}

function uniqueSlugs(
  entries: Array<[string, string]>,
  kind: string,
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Map<string, string>();

  for (const [id, name] of entries) {
    const value = slug(name);
    if (!value) {
      throw new Error(`Figma ${kind} "${name}" has no usable name`);
    }
    const existing = used.get(value);
    if (existing) {
      throw new Error(
        `Figma ${kind}s "${existing}" and "${name}" produce the same slug`,
      );
    }
    used.set(value, name);
    result.set(id, value);
  }

  return result;
}

function directoryMatches(
  outputDirectory: string,
  files: TokenFiles,
): boolean {
  if (!existsSync(outputDirectory)) {
    return false;
  }

  const existingFiles = listFiles(outputDirectory);
  if (existingFiles.length !== files.size) {
    return false;
  }

  return existingFiles.every((filePath) => {
    const expected = files.get(filePath);
    return (
      expected !== undefined &&
      readFileSync(join(outputDirectory, filePath), "utf8") === expected
    );
  });
}

function listFiles(directory: string): string[] {
  const files: string[] = [];

  function visit(currentDirectory: string): void {
    for (const entry of readdirSync(currentDirectory).sort(compareStrings)) {
      const entryPath = join(currentDirectory, entry);
      if (statSync(entryPath).isDirectory()) {
        visit(entryPath);
      } else {
        files.push(relative(directory, entryPath));
      }
    }
  }

  visit(directory);
  return files.sort(compareStrings);
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getAliasId(value: unknown): string | undefined {
  return isRecord(value) &&
    value.type === "VARIABLE_ALIAS" &&
    typeof value.id === "string"
    ? value.id
    : undefined;
}

function invalidValueError(variable: FigmaVariable): Error {
  return new Error(
    `Variable "${variable.name}" has an invalid ${variable.resolvedType} value`,
  );
}

function isFigmaMode(value: unknown): value is FigmaMode {
  return (
    isRecord(value) &&
    typeof value.modeId === "string" &&
    typeof value.name === "string"
  );
}

function isResolvedType(value: unknown): value is FigmaResolvedType {
  return (
    value === "BOOLEAN" ||
    value === "COLOR" ||
    value === "FLOAT" ||
    value === "STRING"
  );
}

function isUnitInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size &&
    [...left].every((entry) => right.has(entry))
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
