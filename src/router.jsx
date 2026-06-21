import { createBrowserRouter, Navigate } from 'react-router-dom';
import Layout from './components/common/Layout';
import ProtectedRoute from './components/common/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import SetPasswordPage from './pages/SetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import AttendancePage from './pages/attendance/AttendancePage';
import AttendanceHistoryPage from './pages/attendance/AttendanceHistoryPage';
import LeaveRequestPage from './pages/leave/LeaveRequestPage';
import LeaveHistoryPage from './pages/leave/LeaveHistoryPage';
import LeaveBalancePage from './pages/leave/LeaveBalancePage';
import TeamReportsPage from './pages/manage/TeamReportsPage';
import ManageTeamPage from './pages/manage/ManageTeamPage';
import MyProjectsPage from './pages/manage/MyProjectsPage';
import ReportsPage from './pages/admin/ReportsPage';
import UnassignedReportPage from './pages/admin/UnassignedReportPage';
import OutsourceManagementPage from './pages/admin/OutsourceManagementPage';
import SiteManagementPage from './pages/admin/SiteManagementPage';
import EventManagementPage from './pages/admin/EventManagementPage';
import LeaveManagementPage from './pages/admin/LeaveManagementPage';
import TotalClosingPage from './pages/admin/TotalClosingPage';
import VehicleLogPage from './pages/admin/VehicleLogPage';
import PurchaseDetailPage from './pages/admin/PurchaseDetailPage';
import SupplierManagementPage from './pages/admin/SupplierManagementPage';
import QuotePage from './pages/admin/QuotePage';
import QuoteFormPage from './pages/admin/QuoteFormPage';
import PurchaseItemPage from './pages/admin/PurchaseItemPage';
import BomPage from './pages/admin/BomPage';
import BomDetailPage from './pages/admin/BomDetailPage';
import PurchaseTrashPage from './pages/admin/PurchaseTrashPage';
import PurchaseListPage from './pages/admin/PurchaseListPage';
import PurchaseLayout from './pages/admin/PurchaseLayout';
import StaffHubPage from './pages/admin/StaffHubPage';
import TrashPage from './pages/admin/TrashPage';
import SiteListPage from './pages/site/SiteListPage';
import SiteClosingPage from './pages/site/SiteClosingPage';
import FileLibraryPage from './pages/library/FileLibraryPage';

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
