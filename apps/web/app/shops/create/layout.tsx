import { AppSidebar } from '../../app-sidebar';
import { AuthGuard } from '../../auth-guard';

export default function CreateShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen">
        <AppSidebar />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
