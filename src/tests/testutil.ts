export const assert = (cond: unknown, msg?: string) => {
  if (!cond) throw new Error(msg ?? "assertion failed");
};
