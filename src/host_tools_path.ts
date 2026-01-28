const dirExists = async (p: string): Promise<boolean> => {
  try {
    const st = await Deno.stat(p);
    return st.isDirectory;
  } catch {
    return false;
  }
};

const readDirNames = async (p: string): Promise<string[]> => {
  const out: string[] = [];
  try {
    for await (const ent of Deno.readDir(p)) {
      if (ent.isDirectory) out.push(ent.name);
    }
  } catch {
    // ignore
  }
  return out;
};

const pickLatestNodeBin = async (home: string): Promise<string | null> => {
  const base = `${home}/.nvm/versions/node`;
  if (!(await dirExists(base))) return null;
  const versions = (await readDirNames(base)).sort();
  if (versions.length === 0) return null;
  const latest = versions[versions.length - 1];
  const bin = `${base}/${latest}/bin`;
  return (await dirExists(bin)) ? bin : null;
};

export const augmentPathForHostTools = async (
  env: Record<string, string>,
  profileNames: ReadonlyArray<string>,
  hostHome: string,
): Promise<void> => {
  const hasHostTools = profileNames.includes("host-tools");
  const hasHostClaude = profileNames.includes("host-claude");
  if (!hasHostTools && !hasHostClaude) return;
  if (!hostHome) return;

  const candidates: (string | null)[] = hasHostTools
    ? [
      `${hostHome}/.local/bin`,
      `${hostHome}/.bun/bin`,
      `${hostHome}/.cargo/bin`,
      `${hostHome}/.deno/bin`,
      `${hostHome}/.npm-global/bin`,
      `${hostHome}/.volta/bin`,
      `${hostHome}/.asdf/shims`,
    ]
    : [
      `${hostHome}/.local/bin`,
    ];

  const nvmBin = await pickLatestNodeBin(hostHome);
  if (nvmBin) candidates.push(nvmBin);

  const existing: string[] = [];
  for (const p of candidates) {
    if (!p) continue;
    if (await dirExists(p)) existing.push(p);
  }

  if (existing.length === 0) return;
  const current = env.PATH ?? "";
  env.PATH = `${existing.join(":")}${current ? ":" + current : ""}`;
};
