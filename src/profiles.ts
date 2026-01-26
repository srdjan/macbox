import { pathJoin } from "./os.ts";

export type Profile = {
  readonly name: string;
  readonly description?: string;
  readonly read_paths?: ReadonlyArray<string>;
  readonly write_paths?: ReadonlyArray<string>;
  /** Allow Mach service lookups. Use `true` to allow all, or an array of global service names. */
  readonly mach_lookup?: boolean | ReadonlyArray<string>;
};

export type LoadedProfiles = {
  readonly profiles: ReadonlyArray<Profile>;
  readonly extraReadPaths: ReadonlyArray<string>;
  readonly extraWritePaths: ReadonlyArray<string>;
  readonly allowMachLookupAll: boolean;
  readonly machServices: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<{ readonly name: string; readonly path: string }>;
};

const trim = (s: string) => s.trim();

export const parseProfileNames = (v: string | undefined): ReadonlyArray<string> => {
  if (!v) return [];
  // Support: --profile a,b,c
  return v.split(",").map(trim).filter(Boolean);
};

const normalizePath = (p: string): string => {
  // Minimal normalization: collapse //, resolve . and ..
  const abs = p.startsWith("/");
  const parts = p.split("/").filter((x) => x.length > 0 && x !== ".");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  const joined = (abs ? "/" : "") + out.join("/");
  return joined === "" ? (abs ? "/" : ".") : joined;
};

const expandTilde = (p: string): string => {
  if (p === "~" || p.startsWith("~/")) {
    const home = Deno.env.get("HOME") ?? "";
    return home ? pathJoin(home, p.slice(2)) : p;
  }
  return p;
};

const toAbsPath = (worktree: string, p: string): string => {
  const t = expandTilde(p);
  if (t.startsWith("/")) return normalizePath(t);
  // Relative paths are resolved under the worktree.
  return normalizePath(pathJoin(worktree, t));
};

const validateProfile = (raw: unknown, nameHint: string): Profile => {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`Profile '${nameHint}': expected JSON object`);
  }
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : nameHint;
  const description = typeof o.description === "string" ? o.description : undefined;
  const read_paths = Array.isArray(o.read_paths) ? o.read_paths.filter((x) => typeof x === "string") as string[] : undefined;
  const write_paths = Array.isArray(o.write_paths) ? o.write_paths.filter((x) => typeof x === "string") as string[] : undefined;
  const mach_lookup = (() => {
    if (typeof o.mach_lookup === "boolean") return o.mach_lookup;
    if (Array.isArray(o.mach_lookup)) return o.mach_lookup.filter((x) => typeof x === "string") as string[];
    return undefined;
  })();
  return { name, description, read_paths, write_paths, mach_lookup };
};

export const userProfilesDir = (): string => {
  const xdg = Deno.env.get("XDG_CONFIG_HOME");
  const home = Deno.env.get("HOME") ?? "";
  const base = xdg ?? (home ? pathJoin(home, ".config") : ".");
  return pathJoin(base, "macbox", "profiles");
};

const envProfilesDir = (): string | null => {
  const raw = Deno.env.get("MACBOX_PROFILES_DIR");
  if (!raw) return null;
  const p = raw.trim();
  if (!p) return null;
  if (p.startsWith("/")) return normalizePath(p);
  return normalizePath(pathJoin(Deno.cwd(), p));
};

const dirExists = (p: string): boolean => {
  try {
    const st = Deno.statSync(p);
    return st.isDirectory;
  } catch {
    return false;
  }
};

export const bundledProfilesDir = (): string => {
  const candidates: string[] = [];
  try {
    const execPath = Deno.execPath();
    const cut = execPath.lastIndexOf("/");
    if (cut > 0) {
      const execDir = execPath.slice(0, cut);
      candidates.push(pathJoin(execDir, "profiles"));
      candidates.push(pathJoin(execDir, "..", "share", "macbox", "profiles"));
    }
  } catch {
    // ignore
  }

  // src/profiles.ts -> ../profiles (repo layout fallback)
  const u = new URL("../profiles/", import.meta.url);
  // URL.pathname is already absolute; on macOS it starts with '/'
  const repoDir = decodeURIComponent(u.pathname.replace(/\/$/, ""));
  candidates.push(repoDir);

  for (const c of candidates) {
    if (dirExists(c)) return c;
  }
  return repoDir;
};

const tryReadJsonFile = async (path: string): Promise<unknown | null> => {
  try {
    const txt = await Deno.readTextFile(path);
    return JSON.parse(txt);
  } catch {
    return null;
  }
};

const isPathLike = (name: string) => name.includes("/") || name.endsWith(".json") || name.startsWith(".");

export const resolveProfileFile = (nameOrPath: string): ReadonlyArray<string> => {
  if (isPathLike(nameOrPath)) {
    const p = nameOrPath.startsWith("/") ? nameOrPath : pathJoin(Deno.cwd(), nameOrPath);
    return [normalizePath(p)];
  }
  const name = nameOrPath;
  const envDir = envProfilesDir();
  return [
    ...(envDir ? [pathJoin(envDir, `${name}.json`)] : []),
    pathJoin(userProfilesDir(), `${name}.json`),
    pathJoin(bundledProfilesDir(), `${name}.json`),
  ];
};

export const loadProfiles = async (
  worktree: string,
  names: ReadonlyArray<string>,
): Promise<LoadedProfiles> => {
  const profiles: Profile[] = [];
  const sources: { name: string; path: string }[] = [];

  const readSet = new Set<string>();
  const writeSet = new Set<string>();
  let allowMachLookupAll = false;
  const machSet = new Set<string>();

  for (const n of names) {
    const candidates = resolveProfileFile(n);
    let loaded: { raw: unknown; path: string } | null = null;
    for (const p of candidates) {
      const raw = await tryReadJsonFile(p);
      if (raw !== null) {
        loaded = { raw, path: p };
        break;
      }
    }
    if (!loaded) {
      throw new Error(`Profile not found: ${n} (searched: ${candidates.join(", ")})`);
    }
    const prof = validateProfile(loaded.raw, n);
    profiles.push(prof);
    sources.push({ name: prof.name, path: loaded.path });

    for (const rp of prof.read_paths ?? []) {
      const ap = toAbsPath(worktree, rp);
      readSet.add(ap);
    }
    for (const wp of prof.write_paths ?? []) {
      const ap = toAbsPath(worktree, wp);
      writeSet.add(ap);
    }

    if (prof.mach_lookup === true) {
      allowMachLookupAll = true;
    } else if (Array.isArray(prof.mach_lookup)) {
      for (const s of prof.mach_lookup) machSet.add(s);
    }
  }

  return {
    profiles,
    extraReadPaths: [...readSet.values()],
    extraWritePaths: [...writeSet.values()],
    allowMachLookupAll,
    machServices: [...machSet.values()].sort((a, b) => a.localeCompare(b)),
    sources,
  };
};

const listJsonNames = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile) continue;
      if (!e.name.endsWith(".json")) continue;
      out.push(e.name.slice(0, -".json".length));
    }
  } catch {
    // ignore
  }
  return out;
};

export const listAvailableProfiles = async (): Promise<ReadonlyArray<string>> => {
  const names = new Set<string>();
  const envDir = envProfilesDir();
  if (envDir) {
    for (const n of await listJsonNames(envDir)) names.add(n);
  }
  for (const n of await listJsonNames(bundledProfilesDir())) names.add(n);
  for (const n of await listJsonNames(userProfilesDir())) names.add(n);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
};
