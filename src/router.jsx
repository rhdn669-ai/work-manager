import { createBrowserRouter, Navigate } from 'react-router-dom';
import Layout from './components/common/Layout';
import ProtectedRoute from './components/common/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ChatPage from './pages/ChatPage';
import AttendancePage from './pages/attendance/AttendancePage';
import AttendanceHistoryPage from './pages/attendance/AttendanceHistoryPage';
import LeaveRequestPage from './pages/leave/LeaveRequestPage';
import LeaveHistoryPage from './pages/leave/LeaveHistoryPage';
import LeaveBalancePage from './pages/leave/LeaveBalancePage';
import TeamReportsPage from './pages/manage/TeamReportsPage';
import ManageTeamPage from './pages/manage/ManageTeamPage';
import UserManagementPage from './pages/admin/UserManagementPage';
import DepartmentManagementPage from './pages/admin/DepartmentManagementPage';
import ReportsPage from './pages/admin/ReportsPage';
import UnassignedReportPage from './pages/admin/UnassignedReportPage';
import SiteManagementPage from './pages/admin/SiteManagementPage';
import EventManagementPage from './pages/admin/EventManagementPage';
import SiteListPage from './pages/site/SiteListPage';
import SiteClosingPage from './pages/site/SiteClosingPage';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/chat', element: <ChatPage /> },
          { path: '/attendance', element: <AttendancePage /> },
          { path: '/attendance/history', element: <AttendanceHistoryPage /> },
          { path: '/leave', element: <LeaveRequestPage /> },
          { path: '/leave/history', element: <LeaveHistoryPage /> },
          { path: '/leave/balance', element: <LeaveBalancePage /> },
          { path: '/sites', element: <SiteListPage /> },
          { path: '/sites/:siteId/:year/:month', element: <SiteClosingPage /> },
          { path: '/manage/team', element: <ManageTeamPage /> },
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
          { path: '/admin/users', element: <UserManagementPage /> },
          { path: '/admin/departments', element: <DepartmentManagementPage /> },
          { path: '/admin/sites', element: <SiteManagementPage /> },
          { path: '/admin/reports', element: <ReportsPage /> },
          { path: '/admin/unassigned', element: <UnassignedReportPage /> },
          { path: '/admin/events', element: <EventManagementPage /> },
        ],
      },
    ],
  },
]);

export default router;
