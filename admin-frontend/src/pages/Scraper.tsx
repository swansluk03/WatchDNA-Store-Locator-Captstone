import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { scraperService, type Brand, type ScraperJob, type ScraperStats } from '../services/scraper.service';
import EndpointDiscovery from '../components/EndpointDiscovery';
import '../styles/Scraper.css';

type TabType = 'jobs' | 'discovery';

const Scraper: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('jobs');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [jobs, setJobs] = useState<ScraperJob[]>([]);
  const [stats, setStats] = useState<ScraperStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewJobModal, setShowNewJobModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [selectedJobLogs, setSelectedJobLogs] = useState<string>('');
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [region, setRegion] = useState('world');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [showRecordsModal, setShowRecordsModal] = useState(false);
  const [recordsJobId, setRecordsJobId] = useState<string>('');
  const [recordsData, setRecordsData] = useState<{
    columns: string[];
    records: Record<string, string>[];
  } | null>(null);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [editedRecords, setEditedRecords] = useState<Map<number, Record<string, string>>>(new Map());
  const [savingRecords, setSavingRecords] = useState(false);
  const [recordsViewMode, setRecordsViewMode] = useState<'all' | 'incomplete'>('all');

  const loadJobs = useCallback(async () => {
    try {
      const params = filterStatus ? { status: filterStatus } : {};
      const { jobs: jobsData } = await scraperService.listJobs(params);
      setJobs(jobsData);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  }, [filterStatus]);

  const previousTabRef = useRef<TabType>(activeTab);

  useEffect(() => {
    loadData();
  }, []);

  // Refetch brands when switching from Endpoint Discovery to Scraping Jobs (so newly saved configs appear)
  useEffect(() => {
    if (previousTabRef.current === 'discovery' && activeTab === 'jobs') {
      loadData();
    }
    previousTabRef.current = activeTab;
  }, [activeTab]);

  // Refresh jobs when filter changes or every 5 seconds
  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [brandsData, statsData] = await Promise.all([
        scraperService.getBrands(),
        scraperService.getStats(),
      ]);
      setBrands(brandsData.filter(b => b.enabled !== false));
      setStats(statsData.stats);
      setJobs(statsData.recentJobs);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleStartScraping = async () => {
    if (!selectedBrand) {
      setError('Please select a brand');
      return;
    }

    const url = customUrl || selectedBrand.url;
    if (!url) {
      setError('URL is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await scraperService.createJob({
        brandName: selectedBrand.id, // Use ID (e.g., "omega_stores") not formatted name
        url,
        region,
      });

      setShowNewJobModal(false);
      setSelectedBrand(null);
      setCustomUrl('');
      setRegion('world');
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start scraping job');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this job?')) {
      return;
    }

    try {
      await scraperService.deleteJob(jobId);
      loadJobs();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete job');
    }
  };

  const handleCancelJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to cancel this running job?')) {
      return;
    }

    try {
      await scraperService.cancelJob(jobId);
      // Refresh jobs list to show cancelled status
      loadJobs();
      // If logs modal is open for this job, refresh it
      if (selectedJobId === jobId && showLogsModal) {
        const logsData = await scraperService.getJobLogs(jobId);
        setSelectedJobLogs(logsData.logs);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to cancel job');
    }
  };

  const handleViewLogs = async (jobId: string) => {
    setSelectedJobId(jobId);
    setShowLogsModal(true);
    setLoadingLogs(true);

    try {
      const logsData = await scraperService.getJobLogs(jobId);
      setSelectedJobLogs(logsData.logs || 'No logs available');
    } catch (err: any) {
      setSelectedJobLogs(`Error loading logs: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleEditRecords = async (jobId: string) => {
    setRecordsJobId(jobId);
    setShowRecordsModal(true);
    setLoadingRecords(true);
    setEditedRecords(new Map());
    setRecordsViewMode('all');
    setError(null);

    try {
      const data = await scraperService.getJobRecords(jobId);
      setRecordsData({ columns: data.columns, records: data.records });
    } catch (err: any) {
      setRecordsData(null);
      setError(err.response?.data?.error || 'Failed to load job records');
    } finally {
      setLoadingRecords(false);
    }
  };

  const handleRecordCellChange = (rowIndex: number, column: string, value: string) => {
    if (!recordsData) return;
    const base = editedRecords.get(rowIndex) ?? recordsData.records[rowIndex];
    const updated = { ...base, [column]: value };
    setEditedRecords(new Map(editedRecords).set(rowIndex, updated));
  };

  const getRecordValue = (rowIndex: number, column: string): string => {
    const edited = editedRecords.get(rowIndex);
    const base = recordsData?.records[rowIndex];
    if (edited && column in edited) return edited[column];
    return base?.[column] ?? '';
  };

  /** Check if a store record is missing important data (phone or address) */
  const storeHasMissingImportantData = (record: Record<string, string>): boolean => {
    const phone = (record['Phone'] ?? '').trim();
    const addr1 = (record['Address Line 1'] ?? '').trim();
    const addr2 = (record['Address Line 2'] ?? '').trim();
    const hasAddress = addr1.length > 0 || addr2.length > 0;
    const hasPhone = phone.length > 0;
    return !hasPhone || !hasAddress;
  };

  /** Records to display based on view mode (all vs incomplete only) */
  const displayedRecords = (() => {
    if (!recordsData) return [];
    if (recordsViewMode === 'all') {
      return recordsData.records.map((r, i) => ({ record: r, originalIndex: i }));
    }
    return recordsData.records
      .map((r, i) => ({ record: r, originalIndex: i }))
      .filter(({ record }) => storeHasMissingImportantData(record));
  })();

  const incompleteCount = recordsData
    ? recordsData.records.filter(storeHasMissingImportantData).length
    : 0;

  const handleSaveRecords = async () => {
    if (!recordsData || editedRecords.size === 0) return;
    setSavingRecords(true);
    setError(null);
    try {
      const rowsToUpdate = Array.from(editedRecords.values());
      const result = await scraperService.updateMasterCsvRows(rowsToUpdate);
      setEditedRecords(new Map());
      setShowRecordsModal(false);
      loadData();
      alert(`Saved ${result.updatedCount} of ${result.totalRequested} records to master CSV.`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save records');
    } finally {
      setSavingRecords(false);
    }
  };

  // Auto-refresh logs for running jobs
  useEffect(() => {
    if (!showLogsModal || !selectedJobId) return;

    const loadLogs = async () => {
      try {
        const logsData = await scraperService.getJobLogs(selectedJobId);
        setSelectedJobLogs(logsData.logs || 'No logs available');
        
        // Stop refreshing if job is completed or failed
        if (logsData.status !== 'running' && logsData.status !== 'queued') {
          return false;
        }
        return true; // Continue refreshing
      } catch (err: any) {
        console.error('Error loading logs:', err);
        return false; // Stop on error
      }
    };

    // Initial load
    loadLogs();

    // Set up auto-refresh for running jobs
    const refreshInterval = setInterval(async () => {
      const shouldContinue = await loadLogs();
      if (!shouldContinue) {
        clearInterval(refreshInterval);
      }
    }, 1000); // Refresh every 1 second for better real-time viewing

    // Cleanup interval when modal closes or component unmounts
    return () => clearInterval(refreshInterval);
  }, [showLogsModal, selectedJobId]);

  const getStatusBadge = (status: string) => {
    const badges: { [key: string]: string } = {
      queued: 'status-badge status-pending',
      running: 'status-badge status-processing',
      completed: 'status-badge status-valid',
      failed: 'status-badge status-invalid',
      cancelled: 'status-badge status-cancelled',
    };
    return badges[status] || 'status-badge';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const calculateDuration = (start: string, end?: string) => {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const seconds = Math.floor((endTime - startTime) / 1000);
    
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="scraper-page">
      <div className="page-header">
        <h1>Store Scraper</h1>
        {activeTab === 'jobs' && (
          <button className="btn btn-primary" onClick={() => setShowNewJobModal(true)}>
            + New Scraping Job
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="scraper-tabs">
        <button
          className={`tab-button ${activeTab === 'jobs' ? 'active' : ''}`}
          onClick={() => setActiveTab('jobs')}
        >
          Scraping Jobs
        </button>
        <button
          className={`tab-button ${activeTab === 'discovery' ? 'active' : ''}`}
          onClick={() => setActiveTab('discovery')}
        >
          Endpoint Discovery
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'discovery' ? (
        <EndpointDiscovery onConfigSaved={loadData} />
      ) : (
        <>

      {/* Stats Cards */}
      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.totalJobs}</div>
            <div className="stat-label">Total Jobs</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.runningJobs}</div>
            <div className="stat-label">Running</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.completedJobs}</div>
            <div className="stat-label">Completed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.failedJobs}</div>
            <div className="stat-label">Failed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.totalRecords.toLocaleString()}</div>
            <div className="stat-label">Total Records</div>
          </div>
        </div>
      )}

      {/* Jobs List */}
      <div className="content-section">
        <div className="section-header">
          <h2>Scraping Jobs</h2>
          <div className="filter-controls">
            <select 
              value={filterStatus} 
              onChange={(e) => {
                setFilterStatus(e.target.value);
              }}
              className="filter-select"
            >
              <option value="">All Status</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Brand</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Records</th>
                <th>Upload</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="no-data">No scraping jobs found</td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td><strong>{job.brandName}</strong></td>
                    <td>
                      <span className={getStatusBadge(job.status)}>
                        {job.status}
                      </span>
                    </td>
                    <td>{formatDate(job.startedAt)}</td>
                    <td>{calculateDuration(job.startedAt, job.completedAt)}</td>
                    <td>{job.recordsScraped > 0 ? job.recordsScraped.toLocaleString() : '-'}</td>
                    <td>
                      {job.uploadId ? (
                        <Link to={`/uploads/${job.uploadId}`} className="link">
                          View Upload
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => handleViewLogs(job.id)}
                        className="btn btn-secondary btn-sm"
                        style={{ marginRight: '0.5rem' }}
                      >
                        View Logs
                      </button>
                      {job.status === 'completed' && job.uploadId && (
                        <button
                          onClick={() => handleEditRecords(job.id)}
                          className="btn btn-primary btn-sm"
                          style={{ marginRight: '0.5rem' }}
                        >
                          Edit Records
                        </button>
                      )}
                      {job.status === 'running' ? (
                        <button
                          onClick={() => handleCancelJob(job.id)}
                          className="btn btn-warning btn-sm"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDeleteJob(job.id)}
                          className="btn btn-danger btn-sm"
                        >
                          Delete
                        </button>
                      )}
                      {job.errorMessage && (
                        <span title={job.errorMessage} className="error-indicator">
                          ⚠️
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Job Modal */}
      {showNewJobModal && (
        <div className="modal-overlay" onClick={() => setShowNewJobModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Start New Scraping Job</h2>
              <button className="modal-close" onClick={() => setShowNewJobModal(false)}>
                ×
              </button>
            </div>

            <div className="modal-body">
              {error && <div className="error-message">{error}</div>}

              <div className="form-group">
                <label>Brand *</label>
                <select
                  value={selectedBrand?.id || ''}
                  onChange={(e) => {
                    const brand = brands.find(b => b.id === e.target.value);
                    setSelectedBrand(brand || null);
                    setCustomUrl(brand?.url || '');
                  }}
                  className="form-control"
                >
                  <option value="">Select a brand...</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name} ({brand.type})
                    </option>
                  ))}
                </select>
              </div>

              {selectedBrand && (
                <>
                  <div className="form-group">
                    <label>API URL *</label>
                    <input
                      type="text"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      className="form-control"
                      placeholder="Enter API endpoint URL"
                    />
                    <small className="form-hint">
                      Default: {selectedBrand.url}
                    </small>
                  </div>

                  {/* Only show region selector for viewport-based scraping */}
                  {selectedBrand.isViewportBased && (
                    <div className="form-group">
                      <label>Region</label>
                      <select
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        className="form-control"
                      >
                        <option value="world">Worldwide</option>
                        <option value="north_america">North America</option>
                        <option value="europe">Europe</option>
                        <option value="asia">Asia</option>
                      </select>
                      <small className="form-hint">
                        Region selection affects viewport-based scraping only
                      </small>
                    </div>
                  )}

                  <div className="info-box">
                    <strong>Type:</strong> {selectedBrand.type}<br />
                    <strong>Method:</strong> {selectedBrand.method || 'GET'}<br />
                    {selectedBrand.description && (
                      <>
                        <strong>Description:</strong> {selectedBrand.description}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowNewJobModal(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleStartScraping}
                disabled={!selectedBrand || submitting}
              >
                {submitting ? 'Starting...' : 'Start Scraping'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {showLogsModal && (
        <div className="modal-overlay" onClick={() => setShowLogsModal(false)}>
          <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Job Logs - {selectedJobId.substring(0, 8)}</h2>
              <button className="modal-close" onClick={() => setShowLogsModal(false)}>
                ×
              </button>
            </div>

            <div className="modal-body">
              {loadingLogs ? (
                <div className="loading">Loading logs...</div>
              ) : (
                <pre className="logs-container" style={{ 
                  maxHeight: '70vh', 
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  backgroundColor: '#1e1e1e',
                  color: '#d4d4d4',
                  padding: '1rem',
                  borderRadius: '4px'
                }}>
                  {selectedJobLogs || 'No logs available'}
                </pre>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowLogsModal(false);
                  setSelectedJobLogs('');
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Job Records Edit Modal */}
      {showRecordsModal && (
        <div className="modal-overlay" onClick={() => setShowRecordsModal(false)}>
          <div className="modal modal-xlarge modal-records" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Job Records – {recordsJobId.substring(0, 8)}</h2>
              <button className="modal-close" onClick={() => setShowRecordsModal(false)}>
                ×
              </button>
            </div>

            <div className="modal-body">
              {error && <div className="error-message">{error}</div>}
              {loadingRecords ? (
                <div className="loading">Loading records...</div>
              ) : recordsData ? (
                <>
                  <p className="records-hint">
                    Edit incorrect or missing fields below. Changes are saved to the master CSV when you click Save.
                  </p>
                  <div className="records-view-toggle">
                    <button
                      type="button"
                      className={`records-view-btn ${recordsViewMode === 'all' ? 'active' : ''}`}
                      onClick={() => setRecordsViewMode('all')}
                    >
                      All records ({recordsData.records.length})
                    </button>
                    <button
                      type="button"
                      className={`records-view-btn ${recordsViewMode === 'incomplete' ? 'active' : ''}`}
                      onClick={() => setRecordsViewMode('incomplete')}
                    >
                      Incomplete only ({incompleteCount})
                    </button>
                  </div>
                  <div className="records-table-wrapper">
                    <table className="records-edit-table">
                      <thead>
                        <tr>
                          <th className="record-warning-col record-header-sticky" title="Stores with missing phone or address">
                            <span className="record-warning-header">⚠</span>
                          </th>
                          {recordsData.columns.map((col) => (
                            <th key={col} className="record-header-sticky">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                            {displayedRecords.length === 0 ? (
                              <tr>
                                <td colSpan={(recordsData.columns.length + 1)} className="records-empty-state">
                                  {recordsViewMode === 'incomplete'
                                    ? 'No records with missing phone or address.'
                                    : 'No records.'}
                                </td>
                              </tr>
                            ) : displayedRecords.map(({ record, originalIndex }) => {
                              const hasMissing = storeHasMissingImportantData(
                                editedRecords.get(originalIndex) ?? record
                              );
                              return (
                                <tr
                                  key={originalIndex}
                                  className={`${editedRecords.has(originalIndex) ? 'row-edited' : ''} ${hasMissing ? 'row-incomplete' : ''}`}
                                >
                                  <td className="record-warning-col">
                                    {hasMissing ? (
                                      <span
                                        className="record-warning-icon"
                                        title="Missing phone number or address"
                                      >
                                        ⚠
                                      </span>
                                    ) : (
                                      <span className="record-warning-empty" />
                                    )}
                                  </td>
                                  {recordsData.columns.map((col) => (
                                    <td key={col}>
                                      {col === 'Handle' ? (
                                        <span className="record-cell-readonly">{getRecordValue(originalIndex, col)}</span>
                                      ) : (
                                        <input
                                          type="text"
                                          className="record-cell-input"
                                          value={getRecordValue(originalIndex, col)}
                                          onChange={(e) => handleRecordCellChange(originalIndex, col, e.target.value)}
                                        />
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="error-message">Could not load records</div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowRecordsModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveRecords}
                disabled={editedRecords.size === 0 || savingRecords}
              >
                {savingRecords ? 'Saving...' : `Save ${editedRecords.size} change(s) to master CSV`}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default Scraper;

