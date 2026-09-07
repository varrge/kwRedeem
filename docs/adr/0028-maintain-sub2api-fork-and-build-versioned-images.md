---
status: accepted
---

# Maintain a Sub2api fork and build versioned images

Sub2api changes that must run inside the gateway will be maintained in a private independent repository with the official project retained as its upstream, rather than extracted from a Docker image or vendored into KaWang. Production will continue to use Docker, but will run images built by CI from known commits, tagged immutably and pinned by digest while preserving the existing Sub2api Operational State. Official updates will normally follow release tags through temporary synchronization branches and pass tests, a production-data-copy migration rehearsal, smoke tests, and artifact traceability before reaching the unrewritten production main branch; this accepts an ongoing upstream-merge burden in exchange for reviewable custom changes and reproducible deployments. The first migration release will contain no functional customization: moderation and UI changes will be designed and released separately after the source-built deployment has been proven equivalent to production.
