import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

const FOLDER_NAME = 'FinancialHub_Docs';

async function getOrCreateFolder(token) {
  const searchRes = await fetch(
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();

  if (searchData.files?.length > 0) {
    return searchData.files[0].id;
  }

  const createRes = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const folder = await createRes.json();
  return folder.id;
}

export function useGoogleDrive() {
  const { googleToken, connectGoogleDrive } = useAuth();

  const getToken = useCallback(async () => {
    if (googleToken) {
      const res = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + googleToken);
      if (res.ok) return googleToken;
    }
    return connectGoogleDrive();
  }, [googleToken, connectGoogleDrive]);

  const uploadFile = useCallback(async (file) => {
    const token = await getToken();
    const folderId = await getOrCreateFolder(token);

    const metadata = {
      name: file.name,
      parents: [folderId],
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const res = await fetch(`${DRIVE_UPLOAD_URL}&fields=id,name,webViewLink,webContentLink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Upload failed');
    }

    const data = await res.json();

    // Make file readable by anyone with the link (so iframe preview works)
    await fetch(`${DRIVE_FILES_URL}/${data.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    return {
      driveFileId: data.id,
      fileName: data.name,
      viewUrl: `https://drive.google.com/file/d/${data.id}/view`,
      previewUrl: `https://drive.google.com/file/d/${data.id}/preview`,
    };
  }, [getToken]);

  const deleteFile = useCallback(async (driveFileId) => {
    if (!driveFileId) return;
    const token = await getToken();
    await fetch(`${DRIVE_FILES_URL}/${driveFileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [getToken]);

  return { uploadFile, deleteFile, getToken };
}
