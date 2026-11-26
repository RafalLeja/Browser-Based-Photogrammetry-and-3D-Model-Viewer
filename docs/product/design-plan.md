# Vitrine: product and design plan

*Status: November 2026. Working product name: **Vitrine** (a museum display case).*

This document explains who Vitrine is for, what the best existing products teach us, which
design rules we follow and why, what is built today, and how we will measure and grow it. It is
the reference for the team and the basis of the investor pitch.

---

## 1. The opportunity in one paragraph

Museums, archives and research groups hold millions of objects that almost nobody can see or
study up close. Photogrammetry can turn ordinary photos into accurate 3D records, but today that
means desktop software, a GPU workstation, a specialist, and a separate publishing platform.
**Vitrine puts the whole chain in the browser**: a curator uploads photos, a server
reconstructs, cleans and compresses the model, and any visitor can turn, measure, annotate,
relight and share it on any device, without installing anything.

## 2. Who it is for

| Persona | Job to be done | What success looks like |
|---|---|---|
| **Curator / collections manager** | Publish objects in 3D without a scanning lab | Upload a photo set, get a clean model and a cover image, add notes, publish |
| **Conservator / researcher** | Record condition and measure features | True-scale measurements, pinned condition notes, a link to the exact view for a colleague |
| **Teacher / student** | Show a detail to a class | One shareable link or an embedded viewer in a course page |
| **Visitor** | Explore an object they cannot touch | Opens instantly, obvious controls, readable notes, works on a phone |

Primary buyer: the institution (curators and conservators). Primary user volume: visitors.

## 3. What the research organisations teach us

We reviewed the current public guidance of the organisations the brief named and turned it into
concrete design rules. Where a source's full research is paywalled we relied only on its public
summaries, and we say so.

| Source | What we took from it | How Vitrine applies it |
|---|---|---|
| **Baymard Institute** (empirical UX benchmarks) | Its public summaries of 3D/AR product research report that most shoppers avoid "view in room" AR, that poor models and clunky controls make people distrust size, and that product imagery is the primary way users evaluate an item. | We lead with a fast, well-framed 3D view and a cover image, not AR. Size is shown as numbers (real dimensions, ruler in mm) rather than implied by placement. AR stays on the roadmap only after measurement is trusted. |
| **MeasuringU** (quantitative UX) | The System Usability Scale averages **68** (50th percentile); on the Sauro–Lewis curved grade scale about **80+ is an A**, and promoters average close to 81. | Our usability target is **SUS ≥ 80** with **≥ 90 % task success**, measured with 8–10 participants (section 8). |
| **AnswerLab & Blink UX** (enterprise research and strategy) | Research with the real users in their real context, map the end-to-end journey, and prioritise by evidence. | The study plan uses the curator's real journey (capture, upload, wait, publish, annotate) and the visitor's (find, inspect, measure, share), not isolated screens. |
| **IDEO** (human-centred design) | Balance **desirability, feasibility and viability**; prototype early to learn. | Desirability: the visitor experience is the hero. Feasibility: COLMAP and WebGPU with a WebGL 2 fallback. Viability: institutions pay for publishing and storage (section 9). We shipped a clickable prototype at week 3 and iterated on feedback. |
| **Interaction Design Foundation** | Progressive disclosure: defer advanced features to secondary UI to serve novices and experts; more than two disclosure levels confuse people. | Two levels only: the dock shows the core tools; details live in five panel tabs (Overview, Notes, Measure, Light, Inspect). Curator-only controls appear only after sign-in. |
| **Smashing Magazine & UX Collective** (practical interface craft) | Canvas content is invisible to assistive technology; respect `prefers-reduced-motion`; give keyboard access; keep performance visible. | Pins are real buttons with names; the canvas has an accessible label and keyboard orbit; camera flights and auto-rotate are disabled under reduced motion; every tool has a keyboard shortcut. |
| **UXPA** (usability practice) | Standard instruments (SUS, task success, time on task) and ethical testing. | Same instruments in our study; consent and anonymised results in `docs/evaluation/`. |
| **Service Design Network** (service blueprints) | Design the front stage (what users see) together with the back stage (processes) from the customer's perspective. | The reconstruction job page exposes the back stage honestly: each stage, its time, the log, and a clear "demo pipeline" label when no GPU is present. |

## 4. Five products we studied

| Product | What it does best | What we adopt | Where we differ |
|---|---|---|---|
| **Sketchfab** (publishing platform) | The reference for publishing and embedding 3D: annotations with camera positions, an "Autopilot" tour through annotations, embed options, a JavaScript Viewer API. | Numbered annotations that fly the camera, a guided tour, iframe embedding, a public viewer API (`viewer/src/types.ts`). | Sketchfab publishes models made elsewhere; Vitrine makes them from photos. |
| **Polycam** (capture app with web platform) | Capture to share in one product; a ruler on the free tier, advanced measurement on business plans; many export formats; public and private links. | A built-in ruler for everyone, shareable links. | We focus on objects and institutions, not rooms and floor plans. |
| **RealityScan** (Epic Games) | Capture coaching: AR guidance shows where more photos are needed, a quality mode colours poorly covered areas, and the rule that every surface point should appear in at least two good photos. | A capture guide with that rule, and a live coverage meter while photos are added. | Coaching in a phone camera view is roadmap; today the browser checks the photo set before upload. |
| **KIRI Engine** | Cross-platform photogrammetry with mesh export; modes for difficult, featureless objects. | Plain-language advice about difficult surfaces in the guide. | Fully browser-based for visitors; reconstruction runs on our server. |
| **Luma AI** | Gaussian-splat showcases with striking visual quality. | The bar for first impressions: the landing page opens on a live model. | Mesh-first: measurable, editable and exportable geometry, which splats are weaker at. |

**Positioning.** Sketchfab-quality viewing and sharing, RealityScan-style capture guidance, and
Polycam-style measurement, combined into one browser workflow aimed at collections.

### 4b. Museum-grade tools and workflows (second round)

The first version looked simple next to the tools museums already use, so a second round looked at
heritage-specific viewers and at how conservators and collection teams actually work.

| Source | What it shows | What we built |
|---|---|---|
| **Smithsonian Voyager** (open-source explorer and story tool) | Annotations, a reader for articles, flexible lighting, guided tours, measurement and cuts through objects, WebXR. | We already had notes, tours, measurement and sections; we added raking light, an object record and kiosk tours. |
| **Sketchfab Model Inspector** | Wireframe, MatCap and vertex-normal views behind number keys, so experts can judge a mesh. | An **Inspect** tab: colour, clay, wireframe and normals on keys 1–4, model statistics and labelled dimensions. |
| **3DHOP** (CNR-ISTI) and its comparison viewer | Measurement, point picking, sections on three axes, light control; two models side by side. | **Compare**: two objects with linked cameras, matched by angle and relative zoom. |
| **Kompakkt** (University of Cologne) | Annotations as a hub of metadata, collections and storytelling for humanities research. | Categorised notes (note, detail, inscription, damage, repair) and a museum record per object. |
| **Raking light** (National Gallery, Canadian Conservation Institute, CAMEO) | A single light 5–10° above the surface reveals cracks, losses and tool marks; conservators take it from several directions. | A **Raking light** preset (6°, no fill light) with a sweep that moves the light around the object. |
| **Condition reporting** (Te Papa, CCI, Museums & Galleries NSW, Utah) | Damage categories, graded severity (negligible to extreme), views of all sides and close-ups. | Damage notes with a **severity**, and a printable **condition report**: four overall views and a close-up per note, damage first. |
| **Open access** (Smithsonian Open Access) | CC0 assets, downloads as glTF, GLB and OBJ. | A licence per object, **GLB/STL/OBJ downloads** only for open licences, and a citation in text and BibTeX. |
| **WCAG 1.1.1** | Non-text content needs a text alternative; there is no standard field for 3D. | A **text description** per object, read out as the 3D view's accessible name. |
| **Photogrammetry blur screening** (variance of the Laplacian, thresholds relative to the set) | Blurry photos can be caught before reconstruction; a fixed threshold misfires, a set-relative one is safer. | A **photo check** in the browser: blur against the set's median, exposure, duplicates and resolution. |
| **Museum kiosks** | Idle timeout of 60–120 s, a warning before reset, an attract loop, large touch targets. | **Kiosk mode** with a 90 s idle default, a 10 s countdown and 48 px targets. |
| **Command palettes** (WAI-ARIA combobox pattern) | Ctrl/⌘+K as the one place to find everything, keyboard first. | A palette for objects (title and accession number), pages and actions. |

## 5. Design principles

1. **The object is the interface.** Full-bleed stage, dark neutral backdrop, controls in a single
   translucent dock that never covers the model's centre.
2. **One accent, many neutrals.** A single blue for actions, system typography (SF Pro on Apple
   devices, Segoe UI on Windows), generous space, light and dark themes from the same tokens.
3. **Two levels of disclosure.** Dock for tools, tabs for detail; nothing deeper.
4. **Honest system status.** Progress rings with real percentages, a stage timeline with
   durations, and labels such as *Demo reconstruction* wherever a result is not what it seems.
5. **Accessible by default.** Contrast ≥ 4.5:1, visible focus, 44 px touch targets, keyboard
   shortcuts, reduced-motion support, labelled pins.
6. **Fast is a feature.** Compressed models, render only when something changes, show the first
   frame as soon as possible.

## 6. What is built (this branch)

| Area | Delivered |
|---|---|
| **Viewer** | WebGPU with WebGL 2 fallback; GLB and PLY; Draco, meshopt and KTX2 decoders; two-click ruler with undo and clear; categorised annotation pins with occlusion dimming and camera flights; guided tour; section plane on X/Y/Z; colour, clay, wireframe and normals render modes; labelled overall dimensions; studio, outdoor, room and raking light with exposure, direction and height; subject-cropped screenshots; STL and OBJ export; shareable views; linked cameras; scrolling shared with the host page; render on demand; keyboard shortcuts. |
| **Web app** | Landing page with product imagery, collection with search (including accession numbers), tag filters, licence badges, sorting and pagination; object page with Overview, Notes, Measure, Light and Inspect panels; museum record, licence, citation and downloads; condition notes and printable reports; compare; kiosk mode; curator dashboard; command palette; upload with an in-browser photo check and a coverage meter; job page with a live stage timeline and log; capture guide; sign-in; embed view; 404. |
| **API** | One FastAPI service: session login (Argon2id, HttpOnly cookie), curator role, objects with search and pagination, museum record, licence and text description, uploads with content checks and zip-slip protection, a background job queue with retry, cancel, logs and stage timings, condition notes with categories and severity, licence-aware downloads, visit counting, dashboard statistics, shared views, thumbnails, ETag caching, rate limits, security headers and additive schema upgrades. SQLite for development, Postgres in production. |
| **Pipeline** | COLMAP reconstruction (existing), plus new post-processing: upright orientation from camera poses, crop to the object around the cameras' target, removal of floating fragments, true scale from a known height, decimation, GLB export with linear vertex colours, and meshopt compression. |
| **Quality** | 41 API tests, 35 pipeline tests, 62 viewer and frontend unit tests, 23 browser end-to-end tests including phone layouts; GitHub Actions CI; Docker Compose deployment. |

Measured on the showcase eagle: the raw reconstruction has 3.2 million triangles in a 90.7 MB
GLB; after cropping, clean-up and compression it has 300 thousand triangles in **2.2 MB (−97.6 %)**.
The W03 test showed the full raw scan orbiting at 60 fps on WebGPU and on WebGL 2 on a desktop GPU.

## 7. Roadmap

| Horizon | Item | Why |
|---|---|---|
| Next | Textured meshes (OpenMVS or a Blender bake) | Sharper surfaces than vertex colours at the same size |
| Next | Scale from an ArUco marker in the photos | True scale without measuring by hand |
| Next | Phone capture coaching | Fewer failed reconstructions (RealityScan's lesson) |
| Later | Organisations, roles and private collections | Needed to sell to institutions |
| Later | USDZ export and IIIF 3D manifests (GLB, STL and OBJ ship today) | Interoperability with museum systems |
| Later | Exhibitions: curated sequences of objects with text | Online exhibitions without a web team |
| Later | Polish and other interface languages | Our first users are Polish institutions |
| Later | WebXR preview | Only once measurement is trusted (Baymard's lesson) |

## 8. How we will measure it

- **Usability study** (Trello W07): 8–10 participants, tasks: find an object, measure a
  dimension, read a note, change the lighting, upload photos. Record success, time and errors;
  SUS after each session. Targets: **SUS ≥ 80**, **task success ≥ 90 %**.
- **Product metrics**: time from upload to published model, share of jobs that succeed, first
  model frame time, median model size, share of visitors who use a tool beyond orbiting.
- **Accuracy**: ruler versus calliper on 3 dimensions per object (Trello W07), target error
  within a few percent.

## 9. Pitch outline

1. **Problem.** Collections are locked away; 3D digitisation needs specialists and several tools.
2. **Solution.** Photos in, measurable 3D out, explored in any browser. Live demo: upload, watch
   the job, open the model, measure, pin a note, share a view.
3. **Why now.** WebGPU in mainstream browsers, mature open-source photogrammetry (COLMAP), and
   compression (meshopt) that makes 3D as light as a photo gallery.
4. **Product.** Sections 6 and 4: what exists, how it compares.
5. **Business model (hypothesis to validate).** Per-institution subscription priced by storage
   and published objects; free public viewing; paid embedding without branding.
6. **Go to market.** Start with university collections and small museums; partner with
   digitisation programmes.
7. **Ask.** Pilot partners for the usability study and accuracy tests; funding for GPU
   reconstruction capacity and texturing.

*Market sizes and prices are deliberately not quoted here; they need sourced research before the
pitch.*

## Sources

- Baymard Institute, "Deprioritize 'View in Room' augmented reality" and product page UX summaries: https://baymard.com/blog/deprioritize-view-in-room-augmented-reality
- MeasuringU, SUS benchmark and curved grading scale: https://measuringu.com/?p=495 ; Lewis & Sauro, *Journal of Usability Studies* 13(3), 2018: https://uxpajournal.org/wp-content/uploads/sites/7/pdf/JUS_Lewis_May2018.pdf
- IDEO, design thinking (desirability, feasibility, viability): https://designthinking.ideo.com/
- Interaction Design Foundation, progressive disclosure: https://ixdf.org/literature/topics/progressive-disclosure ; Nielsen Norman Group on disclosure levels: https://www.nngroup.com/articles/progressive-disclosure/
- Service blueprints (front stage and back stage): https://www.nngroup.com/articles/service-blueprints-definition/ ; https://ixdf.org/literature/article/service-blueprints-communicating-the-design-of-services
- Sketchfab Viewer API and annotations: https://sketchfab.com/developers/viewer/functions ; https://help.sketchfab.com/en/articles/16152039-camera-limits-and-annotations ; embed settings: https://sketchfab.com/blogs/community/discover-our-new-embed-settings
- Polycam pricing and features: https://poly.cam/pricing
- RealityScan step-by-step guide and AR guidance: https://dev.epicgames.com/documentation/realityscan-mobile/RealityScan-Step-by-Step-Guide ; https://digitalproduction.com/2025/11/21/realityscan-mobile-1-8-with-tools-for-on-the-go-scanning/
- KIRI Engine and Luma AI comparison (vendor-written, read with care): https://www.kiriengine.app/blog/comparison/kiri-engine-vs-luma ; 3D scanner app roundup: https://www.3dmag.com/3d-scanners/best-3d-scanning-apps-in-2025/
- Smithsonian Voyager overview: https://smithsonian.github.io/dpo-voyager/explorer/overview ; how to use the 3D viewer: https://3d.si.edu/how-use-3d-viewer
- Sketchfab Model Inspector (wireframe, MatCap, normals): https://help.sketchfab.com/en/articles/16152718 ; https://sketchfab.com/blogs/community/inspect-models-and-textures-like-never-before/
- 3DHOP: https://vcg.isti.cnr.it/3dhop/howto.php ; comparison viewer example: https://virtual-collections.naturalsciences.be/3DHOPs/comparison_viewer.html
- Kompakkt: https://github.com/Kompakkt/Kompakkt ; https://dh2020.adho.org/wp-content/uploads/2020/07/542_BecausetheworldismultidimensionalAnnotationsforstorytellingwith3Dobjects.html
- Raking light: https://nationalgallery.org.uk/paintings/glossary/raking-light ; https://www.canada.ca/en/conservation-institute/services/learning-activities/lighting-techniques.html ; https://cameo.mfa.org/wiki/Raking_light
- Condition reporting: https://www.tepapa.govt.nz/assets/76067/1687925474-26-condition-reporting.pdf ; https://www.canada.ca/en/conservation-institute/services/conservation-preservation-publications/canadian-conservation-institute-notes/condition-reporting-paintings-introduction.html ; https://mgnsw.org.au/wp-content/uploads/2018/11/fact_sheet_condition_reports_the_essentials_2.pdf ; https://artsandmuseums.utah.gov/wp-content/uploads/2022/01/Condition-Report-Checklist-and-Instructions-1.pdf
- Smithsonian Open Access and 3D downloads: https://www.si.edu/openaccess ; https://dashboard.si.edu/openaccess/faq
- WCAG 1.1.1 non-text content: https://www.w3.org/TR/2014/NOTE-UNDERSTANDING-WCAG20-20140311/text-equiv-all.html ; alternative text for glTF: https://equalentry.com/accessibility-gltf-objects/
- Blur screening with the variance of the Laplacian: https://pyimagesearch.com/2015/09/07/blur-detection-with-opencv/ ; set-relative thresholds: https://arxiv.org/pdf/2403.11364
- Kiosk idle timeouts and attract loops: https://www.kioskmarketplace.com/blogs/kiosk-idle-timeout-what-happens-when-they-walk-away ; https://support.kioskgroup.com/article/992-idle-time-reset-alert
- Command palette and the WAI-ARIA combobox pattern: https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/ ; https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
