// Minimal argv parser: supports --k=v, --k v, boolean flags, and `--` passthrough.
export type Parsed = {
  readonly flags: Record<string, string | boolean>;
  readonly _: ReadonlyArray<string>;
  readonly passthrough: ReadonlyArray<string>;
};

const isFlag = (s: string) => s.startsWith("--");

export const parseArgs = (argv: ReadonlyArray<string>): Parsed => {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const passthrough: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      passthrough.push(...argv.slice(i + 1));
      break;
    }
    if (!isFlag(a)) {
      positional.push(a);
      i++;
      continue;
    }
    const eq = a.indexOf("=");
    if (eq >= 0) {
      const k = a.slice(2, eq);
      const v = a.slice(eq + 1);
      flags[k] = v;
      i++;
      continue;
    }
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || isFlag(next)) {
      flags[k] = true;
      i++;
      continue;
    }
    flags[k] = next;
    i += 2;
  }

  return { flags, _: positional, passthrough };
};
