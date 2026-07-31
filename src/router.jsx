import { createBrowserRouter, Navigate } from 'react-router-dom';
import Layout from './components/common/Layout';
import ProtectedRoute from './components/common/ProtectedRoute';
import PurchaseLayout from './pages/admin/PurchaseLayout';
// 첫 화면(로그인)은 정적 — 지연 로딩 시 첫 진입만 느려지므로 제외
import LoginPage from './pages/LoginPage';
import SetPasswordPage from './pages/SetPasswordPage';

// 나머지 페이지는 지연 로딩 — routerPages.js 참조.
import {
  DashboardPage,
  AttendancePage,
  AttendanceHistoryPage,
  LeaveRequestPage,
  LeaveHistoryPage,
  LeaveBalancePage,
  TeamReportsPage,
  ManageTeamPage,
  MyProjectsPage,
  ReportsPage,
  UnassignedReportPage,
  OutsourceManagementPage,
  SiteManagementPage,
  EventManagementPage,
  LeaveManagementPage,
  TotalClosingPage,
  VehicleLogPage,
  PurchaseDetailPage,
  SupplierManagementPage,
  QuotePage,
  QuoteFormPage,
  PurchaseItemPage,
  BomPage,
  BomDetailPage,
  PurchaseTrashPage,
  PurchaseListPage,
  StaffHubPage,
  TrashPage,
  QualityPage,
  QualitySheetPage,
  ProductionPage,
  WorkspaceSelectPage,
  MailSendPage,
  PaymentPage,
  SiteListPage,
  SiteClosingPage,
  FileLibraryPage,
} from './routerPages';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/set-password', element: <SetPasswordPage /> },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    element: <ProtectedRoute />,
    children: [{ path: '/workspace', element: <WorkspaceSelectPage /> }],
  },
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
          { path: '/production', element: <ProductionPage /> },
          { path: '/quality', element: <QualityPage /> },
          { path: '/quality/sheet/:formKey/:id', element: <QualitySheetPage /> },
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
