import type { ReactNode } from 'react';

export const metadata = {
  title: 'Kauppalista vertailija',
  description: 'Projektin perustus valmis',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fi">
      <body style={{ fontFamily: 'sans-serif', margin: 0, background: '#f4f4f5', color: '#111827' }}>
        {children}
      </body>
    </html>
  );
}
