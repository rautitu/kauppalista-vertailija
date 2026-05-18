import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Kauppalista vertailija',
  description: 'Kauppalistan hintavertailu K-ruoan ja S-kauppojen välillä',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fi">
      <body>{children}</body>
    </html>
  );
}
