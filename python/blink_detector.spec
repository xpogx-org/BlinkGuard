# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_submodules

_pkg_modules = [
	m
	for m in collect_submodules("blink_detector_package")
	if ".tests" not in m
]
hiddenimports = _pkg_modules + ["cv2"]

a = Analysis(
	["blink_detector.py"],
	pathex=["."],
	binaries=[],
	datas=[
		("../electron/assets/models", "assets/models"),
		(
			"blink_detector_package/domain/classifier_weights.json",
			"blink_detector_package/domain",
		),
	],
	hiddenimports=hiddenimports,
	hookspath=[],
	hooksconfig={},
	runtime_hooks=[],
	# Unused GUI/stdlib/test modules — verified by import smoke after rebuild.
	excludes=[
		"mediapipe",
		"matplotlib",
		"PIL",
		"tkinter",
		"unittest",
		"pydoc",
		"test",
		"tests",
		"IPython",
		"notebook",
		"scipy",
	],
	noarchive=False,
	optimize=2,
)
pyz = PYZ(a.pure)

exe = EXE(
	pyz,
	a.scripts,
	a.binaries,
	a.datas,
	[],
	name="blink_detector",
	debug=False,
	bootloader_ignore_signals=False,
	strip=False,
	upx=True,
	upx_exclude=[],
	runtime_tmpdir=None,
	console=True,
	disable_windowed_traceback=False,
	argv_emulation=False,
	target_arch=None,
	codesign_identity=None,
	entitlements_file=None,
)
