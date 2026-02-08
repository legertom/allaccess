import "./globals.css";

export const metadata = {
  title: "Equinox NYC Hours",
  description: "Find NYC Equinox clubs open now or at a specific time."
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
