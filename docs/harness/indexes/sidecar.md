# Index: Sidecar

- **What:** Optional Python OpenCV/dlib blink-detector. Core app must work without `electron/resources/blink_detector`. Windows camera open path is field-locked.
- **Where:** `python/blink_detector.py`, `python/blink_detector_package/`, Electron spawn/parse in `electron/infrastructure/sidecar/`.
- **When to open:** Changing detector protocol, models, Windows camera open path, or JSONL debug logs. Skill `blink-detector-sidecar`; rule `camera-detection`. Do not paste the protocol dump here.
