import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useUserProfile } from '../hooks/useUserProfile';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import {
  HiOutlineHome,
  HiOutlineBanknotes,
  HiOutlineReceiptPercent,
  HiOutlineDocumentText,
  HiOutlineChatBubbleBottomCenterText,
  HiOutlineBellAlert,
  HiOutlineChartBarSquare,
  HiOutlineShieldCheck,
  HiArrowRightOnRectangle,
  HiSun,
  HiMoon,
  HiCog6Tooth,
  HiChevronRight,
} from 'react-icons/hi2';

const tabs = [
  { to: '/expenses', icon: HiOutlineReceiptPercent, label: 'Expenses' },
  { to: '/bills', icon: HiOutlineBellAlert, label: 'Bills' },
  { to: '/dashboard', icon: HiOutlineHome, label: 'Home' },
  { to: '/loan', icon: HiOutlineBanknotes, label: 'Loan' },
  { to: '/sms', icon: HiOutlineChatBubbleBottomCenterText, label: 'SMS' },
];

export default function Layout() {
  const { logout, user } = useAuth();
  const { dark, toggle } = useTheme();
  const { profile, saveProfile } = useUserProfile();
  const [showSettings, setShowSettings] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [salary, setSalary] = useState('');
  const [otherIncome, setOtherIncome] = useState('');
  const navigate = useNavigate();

  const openSettings = () => {
    setSalary(profile?.monthlySalary || '');
    setOtherIncome(profile?.otherIncome || '');
    setShowSettings(true);
  };

  const handleSaveIncome = async () => {
    await saveProfile({ monthlySalary: salary, otherIncome });
    setShowSettings(false);
  };

  const goTo = (path) => {
    setShowSettings(false);
    navigate(path);
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
            onClick={() => setShowLogoutConfirm(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            title="Logout"
          >
            <HiArrowRightOnRectangle className="w-5 h-5" />
          </button>
        </div>
      </header>

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
        <div className="space-y-5">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Monthly Salary</label>
            <input
              type="number"
              value={salary}
              onChange={e => setSalary(e.target.value)}
              placeholder="Enter your monthly salary"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Other Income</label>
            <input
              type="number"
              value={otherIncome}
              onChange={e => setOtherIncome(e.target.value)}
              placeholder="Business, freelancing, etc."
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">Total income is used for budget calculations on Dashboard</p>
          <button
            onClick={handleSaveIncome}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Save
          </button>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Tools</p>
            <div className="space-y-1">
              <button onClick={() => goTo('/investments')} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left">
                <HiOutlineChartBarSquare className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                <span className="flex-1 dark:text-gray-200">Investments</span>
                <HiChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
              </button>
              <button onClick={() => goTo('/insurance')} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left">
                <HiOutlineShieldCheck className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                <span className="flex-1 dark:text-gray-200">Insurance Vault</span>
                <HiChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
              </button>
              <button onClick={() => goTo('/documents')} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left">
                <HiOutlineDocumentText className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                <span className="flex-1 dark:text-gray-200">Documents</span>
                <HiChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={showLogoutConfirm}
        title="Logout"
        message="Are you sure you want to logout?"
        confirmText="Logout"
        cancelText="Cancel"
        danger
        onConfirm={() => { setShowLogoutConfirm(false); logout(); }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
}
