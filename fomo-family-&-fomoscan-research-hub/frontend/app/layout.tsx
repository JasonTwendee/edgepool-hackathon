import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../globals.css';

export const metadata: Metadata = {
  title: 'edgepool — Automated Solana vaults',
  description:
    'Edgepool connects investor capital with skilled on-chain traders through transparent automated vaults.',
  icons: {
    icon: '/brand/edgepool-favicon-32.png',
    apple: '/brand/edgepool-favicon-180.png',
  },
  openGraph: {
    title: 'edgepool — Automated Solana vaults',
    description:
      'Edgepool connects investor capital with skilled on-chain traders through transparent automated vaults.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-[#161826] text-[#E9E9ED] antialiased">
        {children}
      </body>
    </html>
  );
}
