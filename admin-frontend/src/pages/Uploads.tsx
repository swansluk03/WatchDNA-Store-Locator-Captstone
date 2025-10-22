import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import '../styles/Uploads.css';

interface Upload {
  id: string;
  filename: string;
  originalFilename: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  status: string;
  validationErrors: any[];
  validationWarnings: any[];
  rowsTotal: number;
  rowsProcessed: number;
  rowsFailed: number;
  brandConfig: string | null;
  scraperType: string | null;
  _count?: {
    validationLogs: number;
    locations: number;
  };
}

const Uploads: React.FC = () => {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadUploads();
  }, []);

  const loadUploads = async () => {
    try {
      const response = await api.get('/uploads');
      setUploads(response.data.uploads);
    } catch (error) {
      console.error('Failed to load uploads:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.csv')) {
      alert('Please select a CSV file');
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      await api.post('/uploads', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Reload uploads
      await loadUploads();

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      alert('File uploaded successfully! Validation in progress...');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this upload?')) {
      return;
    }

    try {
      await api.delete(`/uploads/${id}`);
      setUploads(uploads.filter((u) => u.id !== id));
    } catch (error: any) {
      alert(error.response?.data?.error || 'Delete failed');
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      valid: 'badge-success',
      invalid: 'badge-error',
      pending: 'badge-warning',
      validating: 'badge-info',
    };
    return badges[status] || 'badge-default';
  };

  if (loading) {
    return <div className="loading">Loading uploads...</div>;
  }

  return (
    <div className="uploads-page">
      <div className="page-header">
        <h1>CSV Uploads</h1>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="button button-primary"
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Upload CSV'}
          </button>
        </div>
      </div>

      {uploads.length === 0 ? (
        <div className="empty-state">
          <p>No uploads yet</p>
          <p>Click "Upload CSV" to get started</p>
        </div>
      ) : (
        <table className="uploads-table">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Status</th>
              <th>Rows</th>
              <th>Errors</th>
              <th>Warnings</th>
              <th>Uploaded</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((upload) => (
              <tr key={upload.id}>
                <td>{upload.originalFilename}</td>
                <td>
                  <span className={`badge ${getStatusBadge(upload.status)}`}>
                    {upload.status}
                  </span>
                </td>
                <td>{upload.rowsTotal}</td>
                <td>
                  {upload.validationErrors?.length > 0 && (
                    <span className="error-count">{upload.validationErrors.length}</span>
                  )}
                </td>
                <td>
                  {upload.validationWarnings?.length > 0 && (
                    <span className="warning-count">{upload.validationWarnings.length}</span>
                  )}
                </td>
                <td>{new Date(upload.uploadedAt).toLocaleString()}</td>
                <td className="actions">
                  <Link to={`/uploads/${upload.id}`} className="link">View</Link>
                  <button onClick={() => handleDelete(upload.id)} className="link link-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default Uploads;
