import { useState, useRef } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { useGoogleDrive } from '../hooks/useGoogleDrive';
import { useAuth } from '../contexts/AuthContext';
import Card from '../components/Card';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { HiOutlineDocumentText, HiPlus, HiTrash, HiEye, HiArrowTopRightOnSquare, HiArrowPath } from 'react-icons/hi2';

export default function Documents() {
  const { data: documents, add, remove } = useCollection('documents', 'createdAt');
  const { uploadFile, deleteFile } = useGoogleDrive();
  const { googleToken, refreshGoogleToken } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: '', month: '', salaryAmount: '' });
  const fileRef = useRef(null);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !form.title) return;

    setUploading(true);
    try {
      const driveResult = await uploadFile(file);

      await add({
        title: form.title,
        month: form.month,
        salaryAmount: form.salaryAmount || null,
        fileName: driveResult.fileName,
        driveFileId: driveResult.driveFileId,
        viewUrl: driveResult.viewUrl,
        previewUrl: driveResult.previewUrl,
      });

      setForm({ title: '', month: '', salaryAmount: '' });
      if (fileRef.current) fileRef.current.value = '';
      setShowUpload(false);
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc) => {
    try {
      await deleteFile(doc.driveFileId);
    } catch {
      // Drive file might already be gone — still remove Firestore record
    }
    await remove(doc.id);
  };

  const fmt = (n) => n ? '₹' + Number(n).toLocaleString('en-IN') : '-';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Documents</h2>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <HiPlus className="w-4 h-4" /> Upload
        </button>
      </div>

      {!googleToken && (
        <Card className="!bg-amber-50 !border-amber-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-amber-800">Google Drive not connected</p>
              <p className="text-xs text-amber-600 mt-0.5">Reconnect to upload or delete documents</p>
            </div>
            <button
              onClick={refreshGoogleToken}
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-100 text-amber-700 text-sm rounded-lg hover:bg-amber-200 transition-colors"
            >
              <HiArrowPath className="w-4 h-4" /> Connect
            </button>
          </div>
        </Card>
      )}

      {documents.length === 0 ? (
        <EmptyState icon={HiOutlineDocumentText} message="No documents uploaded" />
      ) : (
        <div className="space-y-3">
          {documents.map(doc => (
            <Card key={doc.id} className="!p-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{doc.title}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    {doc.month && <span>{doc.month}</span>}
                    {doc.salaryAmount && <span>Salary: {fmt(doc.salaryAmount)}</span>}
                    <span className="truncate">{doc.fileName}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setPreview(doc)} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Preview">
                    <HiEye className="w-4 h-4 text-gray-400" />
                  </button>
                  <a href={doc.viewUrl} target="_blank" rel="noreferrer" className="p-1.5 hover:bg-gray-100 rounded-lg" title="Open in Drive">
                    <HiArrowTopRightOnSquare className="w-4 h-4 text-gray-400" />
                  </a>
                  <button onClick={() => setConfirmDelete(doc)} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Delete">
                    <HiTrash className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      <Modal open={showUpload} onClose={() => setShowUpload(false)} title="Upload to Google Drive">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Title</label>
            <input type="text" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Salary Slip - March 2026"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Month</label>
            <input type="month" value={form.month} onChange={e => set('month', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Salary Amount (optional)</label>
            <input type="number" value={form.salaryAmount} onChange={e => set('salaryAmount', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">PDF File</label>
            <input type="file" ref={fileRef} accept=".pdf"
              className="w-full text-sm file:mr-3 file:px-3 file:py-2 file:border-0 file:rounded-lg file:bg-indigo-50 file:text-indigo-600 file:text-sm file:font-medium hover:file:bg-indigo-100" />
          </div>
          <button onClick={handleUpload} disabled={uploading}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {uploading ? 'Uploading to Drive...' : 'Upload'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Document?"
        message={`Are you sure you want to delete "${confirmDelete?.title}"? This will also remove it from Google Drive. This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onConfirm={async () => { await handleDelete(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* PDF Preview Modal — uses Google Drive's built-in embed viewer */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title || 'Preview'}>
        {preview && (
          <div className="w-full" style={{ height: '70vh' }}>
            <iframe
              src={preview.previewUrl}
              className="w-full h-full rounded-xl border border-gray-200"
              allow="autoplay"
              title="PDF Preview"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
