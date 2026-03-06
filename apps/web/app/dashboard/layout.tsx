import { AppSidebar } from '../app-sidebar';
import { AuthGuard } from '../auth-guard';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen">
        <AppSidebar />
        <main className="flex-1 overflow-auto p-3 pl-0">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
