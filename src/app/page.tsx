'use client';

import { AuthProvider } from '@/lib/auth-context';
import { PlatformApp } from '@/components/platform/platform-app';

export default function Home() {
  return (
    <AuthProvider>
      <PlatformApp />
    </AuthProvider>
  );
}
