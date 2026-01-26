export const isMacos = () => Deno.build.os === "darwin";

export const mustExist = async (path: string, hint?: string) => {
  try {
    const st = await Deno.stat(path);
    if (!st.isFile && !st.isSymlink) throw new Error("not a file");
  } catch {
    throw new Error(hint ?? `Required executable not found: ${path}`);
  }
};

export const pathJoin = (...xs: ReadonlyArray<string>) =>
  xs.filter(Boolean).join("/").replaceAll("//", "/");

export const nowCompact = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

// Format expected by `log show --start/--end`: "YYYY-MM-DD HH:MM:SS" (local time).
export const formatLogShowTime = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
