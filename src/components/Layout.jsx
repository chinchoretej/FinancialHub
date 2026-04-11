import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  HiOutlineHome,
  HiOutlineBanknotes,
  HiOutlineReceiptPercent,
  HiOutlineDocumentText,
  HiOutlineChatBubbleBottomCenterText,
  HiArrowRightOnRectangle,
} from 'react-icons/hi2';

const tabs = [
  { to: '/', icon: HiOutlineHome, label: 'Dashboard' },
  { to: '/loan', icon: HiOutlineBanknotes, label: 'Loan' },
  { to: '/expenses', icon: HiOutlineReceiptPercent, label: 'Expenses' },
  { to: '/documents', icon: HiOutlineDocumentText, label: 'Docs' },
  { to: '/sms', icon: HiOutlineChatBubbleBottomCenterText, label: 'SMS' },
];

export default function Layout() {
  const { logout, user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <h1 className="text-lg font-bold text-indigo-600">FinancialHub</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 hidden sm:inline">{user?.email}</span>
          <button
            onClick={logout}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            title="Logout"
          >
            <HiArrowRightOnRectangle className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 pb-20 px-4 py-4 max-w-4xl mx-auto w-full">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-30">
        <div className="flex justify-around max-w-lg mx-auto">
          {tabs.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center py-2 px-3 text-xs transition-colors ${
                  isActive ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
                }`
              }
            >
              <Icon className="w-5 h-5 mb-0.5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
