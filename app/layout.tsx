export const metadata = {
  title: "Centro Sindical — Ingesta",
  description: "Subida de exportaciones de WhatsApp",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#0f172a", color: "#e2e8f0" }}>
        {children}
      </body>
    </html>
  );
}
