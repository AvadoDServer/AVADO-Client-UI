/** Tiny classname joiner — filters falsy values. */
export function cn(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}

export default cn;
