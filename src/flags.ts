export const asString = (v: string | boolean | undefined): string | undefined =>
  v === undefined
    ? undefined
    : typeof v === "string"
    ? v
    : v
    ? "true"
    : "false";

export const requireStringFlag = (
  flagName: string,
  v: string | boolean | undefined,
): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new Error(`macbox: --${flagName} requires a value`);
  }
  const s = v.trim();
  if (!s) {
    throw new Error(`macbox: --${flagName} requires a non-empty value`);
  }
  return s;
};

export const boolFlag = (
  v: string | boolean | undefined,
  dflt: boolean,
): boolean => {
  if (v === undefined) return dflt;
  if (typeof v === "boolean") return v;
  return v === "true" || v === "1" || v === "yes";
};

export const parsePathList = (
  v: string | boolean | undefined,
): ReadonlyArray<string> => {
  if (v === undefined) return [];
  const s = typeof v === "string" ? v : v ? "true" : "";
  if (!s || s === "true") return [];
  return s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
};

/** Parse --env "KEY1=VAL1,KEY2=VAL2" into a record. */
export const parseEnvPairs = (
  v: string | boolean | undefined,
): Readonly<Record<string, string>> => {
  if (v === undefined || typeof v !== "string") return {};
  const result: Record<string, string> = {};
  for (const pair of v.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (key) result[key] = val;
  }
  return result;
};
