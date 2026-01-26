const te = new TextEncoder();

export const sha256Hex = async (s: string): Promise<string> => {
  const h = await crypto.subtle.digest("SHA-256", te.encode(s));
  const bytes = new Uint8Array(h);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};
