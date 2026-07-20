// 지연 로딩 페이지 정의 — router.jsx에서 분리 (react-refresh: 컴포넌트만 export하는 파일).
// 초기 번들에서 제외하고, 방문 시 해당 페이지 코드만 로드. Suspense fallback은 Layout의 <Outlet> 래퍼에서 처리.
import { lazy } from 'react';

export const DashboardPage = lazy(() => import('./pages/DashboardPage'));
export const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage'));
export const AttendanceHistoryPage = lazy(() => import('./pages/attendance/AttendanceHistoryPage'));
export const LeaveRequestPage = lazy(() => import('./pages/leave/LeaveRequestPage'));
export const LeaveHistoryPage = lazy(() => import('./pages/leave/LeaveHistoryPage'));
export const LeaveBalancePage = lazy(() => import('./pages/leave/LeaveBalancePage'));
export const TeamReportsPage = lazy(() => import('./pages/manage/TeamReportsPage'));
export const ManageTeamPage = lazy(() => import('./pages/manage/ManageTeamPage'));
export const MyProjectsPage = lazy(() => import('./pages/manage/MyProjectsPage'));
export const ReportsPage = lazy(() => import('./pages/admin/ReportsPage'));
export const UnassignedReportPage = lazy(() => import('./pages/admin/UnassignedReportPage'));
export const OutsourceManagementPage = lazy(() => import('./pages/admin/OutsourceManagementPage'));
export const SiteManagementPage = lazy(() => import('./pages/admin/SiteManagementPage'));
export const EventManagementPage = lazy(() => import('./pages/admin/EventManagementPage'));
export const LeaveManagementPage = lazy(() => import('./pages/admin/LeaveManagementPage'));
export const TotalClosingPage = lazy(() => import('./pages/admin/TotalClosingPage'));
export const VehicleLogPage = lazy(() => import('./pages/admin/VehicleLogPage'));
export const PurchaseDetailPage = lazy(() => import('./pages/admin/PurchaseDetailPage'));
export const SupplierManagementPage = lazy(() => import('./pages/admin/SupplierManagementPage'));
export const QuotePage = lazy(() => import('./pages/admin/QuotePage'));
export const QuoteFormPage = lazy(() => import('./pages/admin/QuoteFormPage'));
export const PurchaseItemPage = lazy(() => import('./pages/admin/PurchaseItemPage'));
export const BomPage = lazy(() => import('./pages/admin/BomPage'));
export const BomDetailPage = lazy(() => import('./pages/admin/BomDetailPage'));
export const PurchaseTrashPage = lazy(() => import('./pages/admin/PurchaseTrashPage'));
export const PurchaseListPage = lazy(() => import('./pages/admin/PurchaseListPage'));
export const StaffHubPage = lazy(() => import('./pages/admin/StaffHubPage'));
export const TrashPage = lazy(() => import('./pages/admin/TrashPage'));
export const QualityPage = lazy(() => import('./pages/admin/QualityPage'));
export const ProductionPage = lazy(() => import('./pages/production/ProductionPage'));
export const MailSendPage = lazy(() => import('./pages/admin/MailSendPage'));
export const PaymentPage = lazy(() => import('./pages/admin/PaymentPage'));
export const SiteListPage = lazy(() => import('./pages/site/SiteListPage'));
export const SiteClosingPage = lazy(() => import('./pages/site/SiteClosingPage'));
export const FileLibraryPage = lazy(() => import('./pages/library/FileLibraryPage'));
