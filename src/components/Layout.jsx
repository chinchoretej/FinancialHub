import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useUserProfile } from '../hooks/useUserProfile';
import Modal from './Modal';
import {
  HiOutlineHome,
  HiOutlineBanknotes,
  HiOutlineReceiptPercent,
  HiOutlineDocumentText,
  HiOutlineChatBubbleBottomCenterText,
  HiOutlineBellAlert,
  HiOutlineQrCode,
  HiArrowRightOnRectangle,
  HiSun,
  HiMoon,
  HiCog6Tooth,
} from 'react-icons/hi2';

const tabs = [
  { to: '/expenses', icon: HiOutlineReceiptPercent, label: 'Expenses' },
  { to: '/bills', icon: HiOutlineBellAlert, label: 'Bills' },
  { to: '/dashboard', icon: HiOutlineHome, label: 'Home' },
  { to: '/loan', icon: HiOutlineBanknotes, label: 'Loan' },
  { to: '/upi', icon: HiOutlineQrCode, label: 'UPI' },
];

const moreTabs = [
  { to: '/documents', icon: HiOutlineDocumentText, label: 'Documents' },
  { to: '/sms', icon: HiOutlineChatBubbleBottomCenterText, label: 'SMS Parser' },
];

export default function Layout() {
  const { logout, user } = useAuth();
  const { dark, toggle } = useTheme();
  const { profile, saveProfile } = useUserProfile();
  const [showSettings, setShowSettings] = useState(false);
  const [salary, setSalary] = useState('');
  const [showMore, setShowMore] = useState(false);

  const openSettings = () => {
    setSalary(profile?.monthlySalary || '');
    setShowSettings(true);
  };

  const handleSaveSalary = async () => {
    await saveProfile({ monthlySalary: salary });
    setShowSettings(false);
  };

  return (
    <div className="min-h-screen flex flex-col dark:bg-gray-900 transition-colors">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <img src={import.meta.env.BASE_URL + 'logo.svg'} alt="" className="w-8 h-8 rounded-lg" />
          <h1 className="text-lg font-bold">
            <span className="text-[#1a2744] dark:text-white">financial</span><span className="text-[#10b981]">Hub</span>
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">{user?.email}</span>
          <button
            onClick={toggle}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            title={dark ? 'Light mode' : 'Dark mode'}
          >
            {dark ? <HiSun className="w-5 h-5" /> : <HiMoon className="w-5 h-5" />}
          </button>
          <button
            onClick={openSettings}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            title="Settings"
          >
            <HiCog6Tooth className="w-5 h-5" />
          </button>
          <button
            onClick={logout}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            title="Logout"
          >
            <HiArrowRightOnRectangle className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Secondary nav for Docs/SMS on larger screens */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-1 flex items-center gap-4 overflow-x-auto sm:justify-center">
        {moreTabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap ${
                isActive ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300 font-medium' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`
            }
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </NavLink>
        ))}
      </div>

      <main className="flex-1 pb-20 px-4 py-4 max-w-4xl mx-auto w-full">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-30">
        <div className="flex justify-around max-w-lg mx-auto">
          {tabs.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center py-2 px-3 text-xs transition-colors ${
                  isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                }`
              }
            >
              <Icon className="w-5 h-5 mb-0.5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Monthly Salary</label>
            <input
              type="number"
              value={salary}
              onChange={e => setSalary(e.target.value)}
              placeholder="Enter your monthly salary"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Used for budget calculations and savings insights on Dashboard</p>
          </div>
          <button
            onClick={handleSaveSalary}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Save
          </button>
        </div>
      </Modal>
    </div>
  );
}
