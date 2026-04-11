import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
} from 'firebase/auth';
import { auth, googleProvider, isAllowedEmail } from '../lib/firebase';

const AuthContext = createContext(null);
const TOKEN_KEY = 'fh_google_access_token';

function saveToken(result, setGoogleToken) {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    setGoogleToken(credential.accessToken);
    localStorage.setItem(TOKEN_KEY, credential.accessToken);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [googleToken, setGoogleToken] = useState(() => localStorage.getItem(TOKEN_KEY));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser && isAllowedEmail(firebaseUser.email)) {
        setUser(firebaseUser);
      } else {
        setUser(null);
        setGoogleToken(null);
        localStorage.removeItem(TOKEN_KEY);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = useCallback(async () => {
    const result = await signInWithPopup(auth, googleProvider);
    if (!isAllowedEmail(result.user.email)) {
      await signOut(auth);
      throw new Error('Unauthorized. Your account is not allowed to access this app.');
    }
    saveToken(result, setGoogleToken);
    return result;
  }, []);

  const refreshGoogleToken = useCallback(async () => {
    const result = await signInWithPopup(auth, googleProvider);
    saveToken(result, setGoogleToken);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not get Google access token');
    }
    return credential.accessToken;
  }, []);

  const logout = useCallback(async () => {
    setGoogleToken(null);
    localStorage.removeItem(TOKEN_KEY);
    return signOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, googleToken, refreshGoogleToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
