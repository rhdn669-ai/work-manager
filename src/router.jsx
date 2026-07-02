import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import Layout from './components/common/Layout';
import ProtectedRoute from './components/common/ProtectedRoute';
import PurchaseLayout from './pages/admin/PurchaseLayout';
// 첫 화면(로그인)은 정적 — 지연 로딩 시 첫 진입만 느려지므로 제외
import LoginPage from './pages/LoginPage';
import SetPasswordPage from './pages/SetPasswordPage';

// 나머지 페이지는 지연 로딩 — 초기 번들에서 제외하고, 방문 시 해당 페이지 코드만 로드.
// Suspense fallback은 Layout의 <Outlet> 래퍼에서 처리.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage'));
const AttendanceHistoryPage = lazy(() => import('./pages/attendance/AttendanceHistoryPage'));
const LeaveRequestPage = lazy(() => import('./pages/leave/LeaveRequestPage'));
const LeaveHistoryPage = lazy(() => import('./pages/leave/LeaveHistoryPage'));
const LeaveBalancePage = lazy(() => import('./pages/leave/LeaveBalancePage'));
const TeamReportsPage = lazy(() => import('./pages/manage/TeamReportsPage'));
const ManageTeamPage = lazy(() => import('./pages/manage/ManageTeamPage'));
const MyProjectsPage = lazy(() => import('./pages/manage/MyProjectsPage'));
const ReportsPage = lazy(() => import('./pages/admin/ReportsPage'));
const UnassignedReportPage = lazy(() => import('./pages/admin/UnassignedReportPage'));
const OutsourceManagementPage = lazy(() => import('./pages/admin/OutsourceManagementPage'));
const SiteManagementPage = lazy(() => import('./pages/admin/SiteManagementPage'));
const EventManagementPage = lazy(() => import('./pages/admin/EventManagementPage'));
const LeaveManagementPage = lazy(() => import('./pages/admin/LeaveManagementPage'));
const TotalClosingPage = lazy(() => import('./pages/admin/TotalClosingPage'));
const VehicleLogPage = lazy(() => import('./pages/admin/VehicleLogPage'));
const PurchaseDetailPage = lazy(() => import('./pages/admin/PurchaseDetailPage'));
const SupplierManagementPage = lazy(() => import('./pages/admin/SupplierManagementPage'));
const QuotePage = lazy(() => import('./pages/admin/QuotePage'));
const QuoteFormPage = lazy(() => import('./pages/admin/QuoteFormPage'));
const PurchaseItemPage = lazy(() => import('./pages/admin/PurchaseItemPage'));
const BomPage = lazy(() => import('./pages/admin/BomPage'));
const BomDetailPage = lazy(() => import('./pages/admin/BomDetailPage'));
const PurchaseTrashPage = lazy(() => import('./pages/admin/PurchaseTrashPage'));
const PurchaseListPage = lazy(() => import('./pages/admin/PurchaseListPage'));
const StaffHubPage = lazy(() => import('./pages/admin/StaffHubPage'));
const TrashPage = lazy(() => import('./pages/admin/TrashPage'));
const MailSendPage = lazy(() => import('./pages/admin/MailSendPage'));
const PaymentPage = lazy(() => import('./pages/admin/PaymentPage'));
const SiteListPage = lazy(() => import('./pages/site/SiteListPage'));
const SiteClosingPage = lazy(() => import('./pages/site/SiteClosingPage'));
const FileLibraryPage = lazy(() => import('./pages/library/FileLibraryPage'));

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/set-password', element: <SetPasswordPage /> },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/attendance', element: <AttendancePage /> },
          { path: '/attendance/history', element: <AttendanceHistoryPage /> },
          { path: '/leave', element: <LeaveRequestPage /> },
          { path: '/leave/history', element: <LeaveHistoryPage /> },
          { path: '/leave/balance', element: <LeaveBalancePage /> },
          { path: '/sites', element: <SiteListPage /> },
          { path: '/sites/:siteId/:year/:month', element: <SiteClosingPage /> },
          { path: '/manage/team', element: <ManageTeamPage /> },
          { path: '/library', element: <FileLibraryPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute allowedRoles={['admin', 'manager']} />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/manage/leave', element: <TeamReportsPage /> },
          { path: '/manage/my-projects', element: <MyProjectsPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute allowedRoles={['admin']} />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/admin/users', element: <StaffHubPage /> },
          { path: '/admin/sites', element: <SiteManagementPage /> },
          { path: '/admin/reports', element: <ReportsPage /> },
          { path: '/admin/unassigned', element: <UnassignedReportPage /> },
          { path: '/admin/outsource', element: <OutsourceManagementPage /> },
          { path: '/admin/events', element: <EventManagementPage /> },
          { path: '/admin/leaves', element: <LeaveManagementPage /> },
          { path: '/admin/total-closing', element: <TotalClosingPage /> },
          { path: '/admin/vehicle-log', element: <VehicleLogPage /> },
          { path: '/admin/trash', element: <TrashPage /> },
          { path: '/admin/mail', element: <MailSendPage /> },
          { path: '/admin/payment', element: <PaymentPage /> },
          {
            path: '/admin/purchase',
            element: <PurchaseLayout />,
            children: [
              { index: true, element: <PurchaseListPage /> },
              { path: 'bom', element: <BomPage /> },
              { path: 'bom/:projectId', element: <BomDetailPage /> },
              { path: 'suppliers', element: <SupplierManagementPage /> },
              {
                path: 'quotes',
                children: [
                  { index: true, element: <QuotePage /> },
                  { path: 'new', element: <QuoteFormPage /> },
                  { path: ':quoteId', element: <QuoteFormPage /> },
                ],
              },
              { path: 'items', element: <PurchaseItemPage /> },
              { path: 'trash', element: <PurchaseTrashPage /> },
              { path: ':id', element: <PurchaseDetailPage /> },
            ],
          },
        ],
      },
    ],
  },
]);

export default router;
