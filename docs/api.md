
# Draft REST API

**Project:** Browser-Based Photogrammetry & 3D Viewer  
**Base URL:** `/api/v1`

## 1. Objects

| Method | Endpoint | Description |
|---|---|---|
| GET | `/objects` | Get a list of published 3D objects. |
| GET | `/objects/{object_id}` | Get details of a specific object. |
| POST | `/objects` | Create a new object. |
| PUT | `/objects/{object_id}` | Update object information. |
| DELETE | `/objects/{object_id}` | Delete an object. |
| POST | `/objects/{object_id}/publish` | Publish a 3D object. |

## 2. Uploads

| Method | Endpoint | Description |
|---|---|---|
| POST | `/uploads` | Upload photographs for 3D reconstruction. |
| GET | `/uploads/{upload_id}` | Get details of an upload. |
| DELETE | `/uploads/{upload_id}` | Delete uploaded photographs. |

## 3. Jobs

| Method | Endpoint | Description |
|---|---|---|
| POST | `/jobs` | Create a new photogrammetry reconstruction job. |
| GET | `/jobs` | Get a list of reconstruction jobs. |
| GET | `/jobs/{job_id}` | Get the status and details of a reconstruction job. |
| POST | `/jobs/{job_id}/cancel` | Cancel a reconstruction job. |

**Possible job statuses:**
- `pending` – the job is waiting to be processed.
- `processing` – reconstruction is in progress.
- `completed` – reconstruction has finished successfully.
- `failed` – reconstruction failed.
- `cancelled` – the job was cancelled.

## 4. Models

| Method | Endpoint | Description |
|---|---|---|
| GET | `/models/{model_id}` | Get information about a 3D model. |
| GET | `/models/{model_id}/file` | Download or retrieve the 3D model file. |
| DELETE | `/models/{model_id}` | Delete a 3D model. |

## 5. Annotations

| Method | Endpoint | Description |
|---|---|---|
| GET | `/objects/{object_id}/annotations` | Get annotations for a specific object. |
| POST | `/objects/{object_id}/annotations` | Add a new annotation to an object. |
| PUT | `/annotations/{annotation_id}` | Update an existing annotation. |
| DELETE | `/annotations/{annotation_id}` | Delete an annotation. |

## 6. Auth

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | Authenticate a curator. |
| POST | `/auth/logout` | Log out the current user. |
| GET | `/auth/me` | Get information about the currently authenticated user. |

## Notes

- All endpoints use the `/api/v1` prefix for API versioning.
- Authentication is required for curator-only operations.
- Visitors can access published objects, their 3D models, and annotations.
- Interactions such as rotating, zooming, measuring, and adjusting lighting can be handled locally by the frontend 3D viewer without additional API requests.
- This is a draft API specification. Request and response schemas, validation rules, error handling, and authentication details will be defined during implementation.
