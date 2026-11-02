**1. Role: Visitor**

*Functional Requirements*

* **Basic:** As a visitor, I want to browse a collection gallery of digitized objects so that I can select an exhibit to view.


* **Basic:** As a visitor, I want to freely rotate, zoom, and pan the 3D model in the WebGL/WebGPU viewer so that I can examine its details.
* **Extended:** As a visitor, I want to use built-in measurement tools to check the real-world proportions of the scanned object.
* **Extended:** As a visitor, I want to click on annotations on the 3D model to read additional information prepared by the curator.

*Non-functional Requirements*

* As a visitor, I expect the post-processed mesh (after decimation and texture baking) to load and render smoothly without freezing my browser.
* As a visitor, I expect the viewer interface to be responsive and adapt seamlessly to my device's screen size.

**2. Role: Curator**

*Functional Requirements*

* **Basic:** As a curator, I want to log in securely to the application to manage the 3D collections.


* **Basic:** As a curator, I want to upload a set of photographs and monitor the job status so that I can track the progress of the 3D reconstruction pipeline.


* **Extended:** As a curator, I want to pin text annotations directly onto the 3D mesh before publishing it to provide context for visitors.
* **Extended:** As a curator, I want to adjust the lighting controls in the viewer to ensure the textures and models look accurate and realistic.

*Non-functional Requirements*

* As a curator, I want the system to display clear error messages if the underlying photogrammetry pipeline (using COLMAP or OpenMVG) fails, so I can correct the photo inputs.
