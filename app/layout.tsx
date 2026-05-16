import "./globals.css";

export const metadata = {
  title: "Equinox Sundial",
  description: "Find Equinox clubs open now or at a chosen time — map-first, per-club local time."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
