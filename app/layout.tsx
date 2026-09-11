import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Assay — Autonomous Credit Bureau',
  description: 'A pay-per-query onchain credit bureau + autonomous transfer agent.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
