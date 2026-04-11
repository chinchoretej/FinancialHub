import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
} from 'firebase/auth';
import { auth, googleProvider, isAllowedEmail } from '../lib/firebase';

const AuthContext = createContext(null);
const TOKEN_KEY = 'fh_google_access_token';

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
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = useCallback(async (email, password) => {
    if (!isAllowedEmail(email)) {
      throw new Error('Unauthorized email address');
    }
    return signInWithEmailAndPassword(auth, email, password);
  }, []);

  // Separate Google popup only for Drive token (used on Documents page)
  const connectGoogleDrive = useCallback(async () => {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      setGoogleToken(credential.accessToken);
      localStorage.setItem(TOKEN_KEY, credential.accessToken);
      return credential.accessToken;
    }
    throw new Error('Could not get Google Drive access token');
  }, []);

  const logout = useCallback(async () => {
    setGoogleToken(null);
    localStorage.removeItem(TOKEN_KEY);
    return signOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, googleToken, connectGoogleDrive }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
