import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Loan from './pages/Loan';
import Expenses from './pages/Expenses';
import Documents from './pages/Documents';
import SmsParse from './pages/SmsParse';
import Bills from './pages/Bills';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center dark:bg-gray-900">
        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return user ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/expenses" replace /> : children;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter basename="/FinancialHub">
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Navigate to="/expenses" replace />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="loan" element={<Loan />} />
              <Route path="bills" element={<Bills />} />
              <Route path="documents" element={<Documents />} />
              <Route path="sms" element={<SmsParse />} />
            </Route>
            <Route path="*" element={<Navigate to="/expenses" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
