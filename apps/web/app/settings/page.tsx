'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@resale/ui';
import { logoutApi } from '@/lib/auth';

export default function SettingsPage() {
  const router = useRouter();

  async function handleLogout() {
    await logoutApi();
    router.push('/login');
  }

  return (
    <div className="flex h-screen">
      <div className="flex-1 p-6">
        <h1 className="text-heading-lg mb-6">Settings</h1>
        <p className="text-body-lg text-neutral-600 mb-4">
          Settings page — placeholder
        </p>
        <Button variant="outline" onClick={handleLogout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
