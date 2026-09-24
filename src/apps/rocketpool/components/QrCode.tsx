import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** The QR modules for `value` (true = dark), error correction level M. */
export function qrMatrix(value: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(value, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** Quiet zone around the code, in modules (the standard asks for 4). */
const MARGIN = 4;

/**
 * A QR code as an SVG, dark on white in both themes so every phone camera
 * reads it. Drawn from the module matrix: no HTML strings are injected.
 */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const { n, path } = useMemo(() => {
    const m = qrMatrix(value);
    let d = "";
    m.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) d += `M${c + MARGIN} ${r + MARGIN}h1v1h-1z`;
      }),
    );
    return { n: m.length, path: d };
  }, [value]);
  const box = n + MARGIN * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${box} ${box}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="h-auto max-w-full rounded-lg"
      data-testid="qr-code"
    >
      <rect width={box} height={box} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
