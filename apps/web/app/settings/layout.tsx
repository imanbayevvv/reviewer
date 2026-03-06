import { AppSidebar } from '../app-sidebar';
import { AuthGuard } from '../auth-guard';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen">
        <AppSidebar />
        {children}
      </div>
    </AuthGuard>
  );
}
