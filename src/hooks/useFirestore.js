import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

export function useCollection(collectionName, orderField = 'createdAt', filters = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const constraints = filters.map(f => where(f.field, f.op, f.value));
    if (orderField) {
      constraints.push(orderBy(orderField, 'desc'));
    }
    const q = query(collection(db, collectionName), ...constraints);

    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [collectionName, orderField, JSON.stringify(filters)]);

  const add = useCallback(async (item) => {
    return addDoc(collection(db, collectionName), {
      ...item,
      createdAt: serverTimestamp(),
    });
  }, [collectionName]);

  const update = useCallback(async (id, item) => {
    return updateDoc(doc(db, collectionName, id), {
      ...item,
      updatedAt: serverTimestamp(),
    });
  }, [collectionName]);

  const remove = useCallback(async (id) => {
    return deleteDoc(doc(db, collectionName, id));
  }, [collectionName]);

  return { data, loading, add, update, remove };
}
