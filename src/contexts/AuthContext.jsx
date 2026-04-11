import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  GoogleAuthProvider,
} from 'firebase/auth';
import { auth, googleProvider, isAllowedEmail } from '../lib/firebase';

const AuthContext = createContext(null);

const TOKEN_KEY = 'fh_google_access_token';
const REDIRECT_KEY = 'fh_auth_redirect_pending';
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function extractToken(result, setGoogleToken) {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    setGoogleToken(credential.accessToken);
    saveToken(credential.accessToken);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [googleToken, setGoogleToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const redirectResolved = useRef(false);

  useEffect(() => {
    const hasPendingRedirect = sessionStorage.getItem(REDIRECT_KEY);

    // First, resolve any pending redirect before we trust onAuthStateChanged
    getRedirectResult(auth)
      .then((result) => {
        sessionStorage.removeItem(REDIRECT_KEY);
        if (result) {
          if (!isAllowedEmail(result.user.email)) {
            signOut(auth);
          } else {
            extractToken(result, setGoogleToken);
          }
        }
      })
      .catch(() => {
        sessionStorage.removeItem(REDIRECT_KEY);
      })
      .finally(() => {
        redirectResolved.current = true;
      });

    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser && isAllowedEmail(firebaseUser.email)) {
        setUser(firebaseUser);
        setLoading(false);
      } else if (!hasPendingRedirect || redirectResolved.current) {
        // Only treat as "no user" if we're not mid-redirect
        setUser(null);
        setGoogleToken(null);
        localStorage.removeItem(TOKEN_KEY);
        setLoading(false);
      }
      // If redirect is pending and user is null, keep loading=true and wait
    });

    // Safety timeout — if redirect takes too long, stop loading anyway
    const timeout = setTimeout(() => {
      setLoading((prev) => {
        if (prev) redirectResolved.current = true;
        return false;
      });
    }, 5000);

    return () => {
      unsub();
      clearTimeout(timeout);
    };
  }, []);

  const login = async () => {
    if (isMobile) {
      sessionStorage.setItem(REDIRECT_KEY, '1');
      signInWithRedirect(auth, googleProvider);
      return;
    }
    const result = await signInWithPopup(auth, googleProvider);
    if (!isAllowedEmail(result.user.email)) {
      await signOut(auth);
      throw new Error('Unauthorized. Your account is not allowed to access this app.');
    }
    extractToken(result, setGoogleToken);
    return result;
  };

  const refreshGoogleToken = useCallback(async () => {
    if (isMobile) {
      sessionStorage.setItem(REDIRECT_KEY, '1');
      signInWithRedirect(auth, googleProvider);
      return;
    }
    const result = await signInWithPopup(auth, googleProvider);
    extractToken(result, setGoogleToken);
    if (!GoogleAuthProvider.credentialFromResult(result)?.accessToken) {
      throw new Error('Could not get Google access token');
    }
    return GoogleAuthProvider.credentialFromResult(result).accessToken;
  }, []);

  const logout = async () => {
    setGoogleToken(null);
    localStorage.removeItem(TOKEN_KEY);
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
