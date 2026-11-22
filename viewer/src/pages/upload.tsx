import React, { useState, useRef } from 'react';
import './upload.css';
import { Link, Routes } from 'react-router';

interface PipelineJob {
  id: string;
  objectName: string;
  folderName: string;
  photoCount: number;
  step: string;
  stepLabel: string;
  progress: number;
  createdAt: string;
  errorMessage?: string;
}

interface SSEPayload {
  step: string;
  label?: string;
  progress?: number;
  error?: string;
}

export function Upload() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [folderName, setFolderName] = useState<string>('');
  const [objectName, setObjectName] = useState<string>('');
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED'>('ALL');
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const allFiles = Array.from(e.target.files);

    const imageFiles = allFiles.filter((file) =>
      file.type.startsWith('image/') || /\.(jpg|jpeg|png|tif|tiff)$/i.test(file.name)
    );

    if (imageFiles.length > 0) {
      const relativePath = imageFiles[0].webkitRelativePath;
      const extractedFolder = relativePath ? relativePath.split('/')[0] : 'Selected Folder';

      setFolderName(extractedFolder);
      setSelectedFiles(imageFiles);

      if (!objectName) {
        setObjectName(extractedFolder);
      }
    }
  };


  const createInitialJob = (
    objectNameInput: string,
    folderName: string,
    photoCount: number
  ): PipelineJob => {
    const jobId = `JOB #${Math.floor(100 + Math.random() * 900)}`;
    const resolvedName = objectNameInput.trim() || folderName || 'Untitled Object';

    return {
      id: jobId,
      objectName: resolvedName,
      folderName,
      photoCount,
      step: 'INIT',
      stepLabel: 'Starting...',
      progress: 0,
      createdAt: 'just now',
    };
  };

  const buildPipelineFormData = (objectName: string, files: File[]): FormData => {
    const formData = new FormData();
    formData.append('object_name', objectName);
    files.forEach((file) => {
      formData.append('files', file, file.name);
    });
    return formData;
  };

  const parseSSELine = (line: string): SSEPayload | null => {
    if (!line.startsWith('data: ')) return null;

    const rawData = line.replace('data: ', '').trim();
    if (!rawData) return null;

    try {
      return JSON.parse(rawData) as SSEPayload;
    } catch {
      return { step: rawData, label: rawData };
    }
  };


  const streamPipelineStatus = async (
    body: ReadableStream<Uint8Array>,
    jobId: string,
    onStatusUpdate: (jobId: string, payload: SSEPayload) => void
  ) => {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const parsed = parseSSELine(line.trim());
        if (parsed) {
          onStatusUpdate(jobId, parsed);
        }
      }
    }
  };

  const resetForm = () => {
    setSelectedFiles([]);
    setFolderName('');
    setObjectName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };


  const handleStartPipeline = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);

    const newJob = createInitialJob(objectName, folderName, selectedFiles.length);
    const formData = buildPipelineFormData(newJob.objectName, selectedFiles);

    setJobs((prev) => [newJob, ...prev]);
    resetForm();

    try {
      const response = await fetch('http://localhost:8000/api/pipeline/start', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      await streamPipelineStatus(response.body, newJob.id, updateJobStatus);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Pipeline connection failed';
      updateJobStatus(newJob.id, { step: 'ERROR', label: 'Failed', progress: 0, error: message });
    } finally {
      setIsUploading(false);
    }
  };

  const updateJobStatus = (jobId: string, payload: SSEPayload) => {
    setJobs((previousJobs) =>
      previousJobs.map((job) => {
        if (job.id !== jobId) return job;

        return {
          ...job,
          step: payload.step,
          stepLabel: payload.label ?? payload.step,
          progress: payload.progress ?? job.progress,
          errorMessage: payload.error,
        };
      })
    );
  };

  const filteredJobs = jobs.filter((job) => {
    if (filter === 'ACTIVE') return job.step !== 'FINISHED' && job.step !== 'ERROR';
    if (filter === 'COMPLETED') return job.step === 'FINISHED';
    return true;
  });

  return (
    <div className="upload-page">
      <header className="upload-header">
        <small className="eyebrow">DIGITAL COLLECTIONS LAB</small>
        <h1>Photogrammetry pipeline</h1>
        <p>Create high-fidelity 3D records from your image folder and monitor each stage of reconstruction.</p>
      </header>

      <section className="upload-section">
        <h2>1. Upload image folder</h2>
        <p>Select a folder containing a complete photo set for a single collection object.</p>

        <div className="upload-grid">
          <div className="dropzone">
            <p>Choose a folder with photos from your computer</p>

            <input
              ref={fileInputRef}
              type="file"
              // @ts-expect-error 
              webkitdirectory="true"
              directory="true"
              multiple
              onChange={handleFolderSelect}
              hidden
            />

            <button
              type="button"
              className="btn-browse"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              Browse folder
            </button>
            <p className="hint-text">JPG or PNG inside folder supported</p>
          </div>

          <div className="upload-controls">
            <div className="form-group">
              <label htmlFor="objectName">OBJECT NAME</label>
              <input
                id="objectName"
                type="text"
                placeholder="e.g. Ceramic vessel"
                value={objectName}
                onChange={(e) => setObjectName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <span className="label-text">SELECTED FOLDER</span>
              <div className="selected-box">
                {selectedFiles.length > 0 ? (
                  <div>
                    <strong>📁 {folderName}</strong>
                    <div>{selectedFiles.length} photos ready</div>
                  </div>
                ) : (
                  <span className="empty-text">No folder selected</span>
                )}
              </div>
            </div>

            <button
              type="button"
              className="btn-start"
              onClick={handleStartPipeline}
              disabled={selectedFiles.length === 0 || isUploading}
            >
              {isUploading ? 'Uploading...' : 'Start pipeline →'}
            </button>
          </div>
        </div>
      </section>

      <section className="jobs-section">
        <div className="jobs-header">
          <div>
            <h2>2. Job status (Pipeline view)</h2>
            <small>{jobs.filter((j) => j.step !== 'FINISHED').length} active jobs</small>
          </div>

          <div className="filter-tabs">
            <button onClick={() => setFilter('ALL')} disabled={filter === 'ALL'}>All</button>
            <button onClick={() => setFilter('ACTIVE')} disabled={filter === 'ACTIVE'}>Active</button>
            <button onClick={() => setFilter('COMPLETED')} disabled={filter === 'COMPLETED'}>Completed</button>
          </div>

          {jobs.some((job) => job.step === 'FINISHED') && (
            <nav className="navigation">
              <Link to="/viewer" className="nav-btn">
                Show Model
              </Link>
            </nav>
          )}
        </div>

        <div className="jobs-list">
          {filteredJobs.length === 0 && (
            <p className="empty-jobs">
              No pipeline jobs running yet. Select a folder above to start.
            </p>
          )}

          {filteredJobs.map((job) => (
            <div key={job.id} className="job-card">
              <div className="job-info">
                <div className="job-meta">
                  {job.id} • {job.photoCount} photos ({job.folderName})
                </div>
                <strong className="job-title">{job.objectName}</strong>
              </div>

              <div className="job-progress-wrapper">
                <div className="job-status-row">
                  <span>
                    ● <strong>{job.stepLabel}</strong> ({job.step})
                  </span>
                  <span>{job.progress}%</span>
                </div>

                <progress value={job.progress} max={100} />

                {job.errorMessage && (
                  <div className="job-error">
                    Error: {job.errorMessage}
                  </div>
                )}
              </div>

              <div className="job-time">{job.createdAt}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}