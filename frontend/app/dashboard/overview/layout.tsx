import QueryProvider from '@/components/QueryProvider';

export default function DashboardOverviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <QueryProvider>{children}</QueryProvider>;
}
