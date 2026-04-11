import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
} from 'firebase/auth';
import { auth, googleProvider, ALLOWED_EMAIL } from '../lib/firebase';

const AuthContext = createContext(null);

const TOKEN_KEY = 'fh_google_access_token';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [googleToken, setGoogleToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser && firebaseUser.email === ALLOWED_EMAIL) {
        setUser(firebaseUser);
      } else {
        setUser(null);
        setGoogleToken(null);
        sessionStorage.removeItem(TOKEN_KEY);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    if (result.user.email !== ALLOWED_EMAIL) {
      await signOut(auth);
      throw new Error('Unauthorized. Only ' + ALLOWED_EMAIL + ' can access this app.');
    }
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      setGoogleToken(credential.accessToken);
      sessionStorage.setItem(TOKEN_KEY, credential.accessToken);
    }
    return result;
  };

  // Re-auth popup to get a fresh Google access token (needed for Drive API after session expires)
  const refreshGoogleToken = useCallback(async () => {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      setGoogleToken(credential.accessToken);
      sessionStorage.setItem(TOKEN_KEY, credential.accessToken);
      return credential.accessToken;
    }
    throw new Error('Could not get Google access token');
  }, []);

  const logout = async () => {
    setGoogleToken(null);
    sessionStorage.removeItem(TOKEN_KEY);
    return signOut(auth);
  };

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
