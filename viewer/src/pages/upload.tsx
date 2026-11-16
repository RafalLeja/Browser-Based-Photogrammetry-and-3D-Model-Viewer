import React, { useState, useRef } from 'react';
import './upload.css';

type PipelineStep =
  | 'INIT'
  | 'LOADING'
  | 'FEATURE_EXTRACTION'
  | 'FEATURE_MATCHING'
  | 'SPARSE_RECONSTRUCTION'
  | 'FINISHED'
  | 'ERROR';

interface PipelineJob {
  id: string;
  objectName: string;
  folderName: string;
  photoCount: number;
  step: PipelineStep;
  progress: number;
  createdAt: string;
  errorMessage?: string;
}

const STEP_CONFIG: Record<PipelineStep, { label: string; progress: number }> = {
  INIT: { label: 'Initializing', progress: 5 },
  LOADING: { label: 'Loading images', progress: 20 },
  FEATURE_EXTRACTION: { label: 'Feature extraction', progress: 45 },
  FEATURE_MATCHING: { label: 'Feature matching', progress: 70 },
  SPARSE_RECONSTRUCTION: { label: 'Sparse reconstruction', progress: 90 },
  FINISHED: { label: 'Done', progress: 100 },
  ERROR: { label: 'Failed', progress: 0 },
};

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
      progress: STEP_CONFIG.INIT.progress,
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

  const parseSSELine = (
    line: string
  ): { step: PipelineStep; error?: string } | null => {
    if (!line.startsWith('data: ')) return null;

    const rawData = line.replace('data: ', '').trim();
    if (!rawData) return null;

    try {
      return JSON.parse(rawData) as { step: PipelineStep; error?: string };
    } catch {
      const stepName = rawData as PipelineStep;
      return STEP_CONFIG[stepName] ? { step: stepName } : null;
    }
  };


  const streamPipelineStatus = async (
    body: ReadableStream<Uint8Array>,
    jobId: string,
    onStatusUpdate: (jobId: string, step: PipelineStep, error?: string) => void
  ) => {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        const parsed = parseSSELine(line);
        if (parsed) {
          onStatusUpdate(jobId, parsed.step, parsed.error);
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
      updateJobStatus(newJob.id, 'ERROR', message);
    } finally {
      setIsUploading(false);
    }
  };

  const updateJobStatus = (
    jobId: string,
    step: PipelineStep,
    errorMessage?: string
  ) => {
    setJobs((previousJobs) => {
      return previousJobs.map((job) => {
        if (job.id !== jobId) {
          return job;
        }

        return {
          ...job,
          step: step,
          progress:
            STEP_CONFIG[step]?.progress ?? job.progress,
          errorMessage: errorMessage,
        };
      });
    });
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
                    ● <strong>{STEP_CONFIG[job.step].label}</strong> ({job.step})
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