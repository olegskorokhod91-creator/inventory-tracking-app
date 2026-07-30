// Shared visual design for every generated PWA/favicon icon (icon.tsx,
// apple-icon.tsx, and the manifest-referenced icon-*.png routes) - a single
// definition so the "OT" monogram/black background stays consistent instead
// of copy-pasted per file. No logo asset exists yet; swap this out once one
// does.
export function pwaIconElement(fontSize: number) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#000000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#ffffff",
        fontSize,
        fontWeight: 700,
        fontFamily: "sans-serif",
      }}
    >
      OT
    </div>
  );
}
