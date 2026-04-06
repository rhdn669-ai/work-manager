import { createBrowserRouter, Navigate } from 'react-router-dom';
import Layout from './components/common/Layout';
import ProtectedRoute from './components/common/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AttendancePage from './pages/attendance/AttendancePage';
import AttendanceHistoryPage from './pages/attendance/AttendanceHistoryPage';
import LeaveRequestPage from './pages/leave/LeaveRequestPage';
import LeaveHistoryPage from './pages/leave/LeaveHistoryPage';
import LeaveBalancePage from './pages/leave/LeaveBalancePage';
import ManageLeavePage from './pages/manage/ManageLeavePage';
import ManageOvertimePage from './pages/manage/ManageOvertimePage';
import UserManagementPage from './pages/admin/UserManagementPage';
import DepartmentManagementPage from './pages/admin/DepartmentManagementPage';
import ReportsPage from './pages/admin/ReportsPage';

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
          { path: '/attendance', element: <AttendancePage /> },
          { path: '/attendance/history', element: <AttendanceHistoryPage /> },
          { path: '/leave', element: <LeaveRequestPage /> },
          { path: '/leave/history', element: <LeaveHistoryPage /> },
          { path: '/leave/balance', element: <LeaveBalancePage /> },
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
          { path: '/manage/overtime', element: <ManageOvertimePage /> },
          { path: '/manage/leave', element: <ManageLeavePage /> },
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
          { path: '/admin/reports', element: <ReportsPage /> },
        ],
      },
    ],
  },
]);

export default router;
