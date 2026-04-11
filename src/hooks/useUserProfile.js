import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

const PROFILE_DOC = 'userProfile';
const SETTINGS_COLLECTION = 'settings';

export function useUserProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, SETTINGS_COLLECTION, PROFILE_DOC);
    getDoc(ref).then(snap => {
      if (snap.exists()) setProfile(snap.data());
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const saveProfile = useCallback(async (data) => {
    const ref = doc(db, SETTINGS_COLLECTION, PROFILE_DOC);
    const payload = { ...data, updatedAt: serverTimestamp() };
    await setDoc(ref, payload, { merge: true });
    setProfile(prev => ({ ...prev, ...data }));
  }, []);

  return { profile, loading, saveProfile };
}
