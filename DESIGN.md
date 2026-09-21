# Sauna Studio website

Visual thesis: a calm product studio, with pale mineral green, matte spruce, generous space, and a large interactive model as the focal point.

Palette: mineral #e7ebe4, paper #fafbf7, ink #25352b, pine #365443, secondary #738075, line #dce2d8. One green accent; no decorative gradients or card grid.

Type: locally hosted Manrope for the interface and product title; system sans-serif fallback. Strong size hierarchy, sentence case, restrained weights.

Layout: full-width navigation, dominant 3D workspace on the left, flat configuration inspector on the right. On phones, the model sits above the controls. A short material-detail section uses the actual Blender interior render. Space checking opens a focused dialog with a plan and measurements.

Content plan: interactive product and configuration; material and dimensions; space checking and saved design. Every control performs a real action; no pricing, shopping, or unsupported manufacturing claims.

Interaction thesis: ease the model into its initial camera framing; animate the door and camera transitions in response to controls; smoothly open the measurement dialog. Respect reduced motion.

Architecture: Vite and vanilla modules. Configuration state owns validated selections and URL persistence. The viewer owns GLB assets, transforms, lights and camera. The space checker owns user-entered dimensions and camera lifecycle. XR owns device sessions and restores the viewer on exit. No backend or native app is required.

Fit contract: compare a rectangular available space with the cabin, its selected orientation, and optionally its 62 cm door sweep. Report dimensional fit only. Unknown installation clearances are stated separately. Camera preview without spatial tracking never produces a measured fit result. AR runs only with device support and a secure context; iOS can prepare a USDZ for Quick Look.

Validation: production build, browser interaction checks for all four assemblies, door transforms, source GLB dimensions, optional lighting, fit calculations and invalid input, storage/link restoration, camera rejection/cleanup, desktop and mobile visual inspection. Device AR/VR needs physical-device testing and is reported separately.
