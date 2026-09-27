import type { Metadata, Viewport } from 'next';
import { SITE_URL } from '@/lib/webflow';

export const metadata: Metadata = { metadataBase: new URL(SITE_URL) };

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // webflow.js and the original head script add classes/attributes to <html> and <body> before hydration.
  return (
    <html suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
