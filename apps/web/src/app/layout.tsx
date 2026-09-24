import type { Metadata } from 'next';
import './globals.css';
import { Curtain } from '@/components/curtain';
import { Cursor } from '@/components/cursor';
import { PREFERENCES_SCRIPT } from '@/lib/preferences';

export const metadata: Metadata = {
  title: 'OMNIPLAY — Your universal gaming identity',
  description:
    'One identity. Every game. Your entire gaming history, unified across Steam, Xbox and PlayStation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* The script below writes a class and a data attribute onto this
       element before React sees it, which is exactly the mismatch this
       warning exists to catch — and exactly what is wanted here. */
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Barlow and Barlow Condensed are one superfamily: the body and the
            display cut share bone structure, so a heading and the paragraph
            under it agree. The condensed italics at 700 and 800 are what the
            menus lean on. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,600;1,700;1,800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        {/* Interface preferences, applied before the first paint. Reading
            them in React instead would animate the first frame and not the
            second, which is worse than either setting on its own. */}
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_SCRIPT }} />
      </head>
      <body>
        {children}
        <Curtain />
        <Cursor />
      </body>
    </html>
  );
}
