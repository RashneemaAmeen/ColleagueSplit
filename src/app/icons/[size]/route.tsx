import { ImageResponse } from "next/og";

// Generates the PWA / home-screen icons at request time (cached). The mark is two overlapping
// circles — colleagues sharing a bill — in the brand teal. `maskable-512` adds safe-area padding.
export const dynamic = "force-static";

export function generateStaticParams() {
  return ["180", "192", "512", "maskable-512"].map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const maskable = raw.startsWith("maskable");
  const size = Number(raw.replace("maskable-", ""));
  if (![180, 192, 512].includes(size)) return new Response("Not found", { status: 404 });

  // Maskable icons keep the artwork inside the central 80% safe zone.
  const art = maskable ? size * 0.62 : size * 0.78;
  const r = art * 0.3;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f766e",
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <div style={{ display: "flex", position: "relative", width: art, height: art * 0.6 }}>
          <div
            style={{
              position: "absolute",
              left: art * 0.14,
              top: (art * 0.6 - r * 2) / 2,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              background: "#ffffff",
              opacity: 0.95,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: art * 0.14 + r * 1.15,
              top: (art * 0.6 - r * 2) / 2,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              background: "#5eead4",
              opacity: 0.92,
            }}
          />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
