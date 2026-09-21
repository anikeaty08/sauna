# Sauna — Blender delivery

Open `OPEN-SAUNA.cmd` on this machine, or open [sauna-complete.blend](output/blender/sauna-complete.blend) in Blender. The finished model uses metres and contains the cabin, both door and heater variants, optional lighting, and a hidden 1.7 m reference figure.

For an already selected configuration, open any of the four `.blend` files in [output/blender/configurations](output/blender/configurations). Textures are packed and instructions are embedded in the `START HERE - Sauna` text block.

- [Model views and review](output/blender/REVIEW.md)
- [Detailed workflow, controls, and assumptions](output/blender/README.md)
- [Finished GLB assets and manifest](output/blender/assets)
- [Source geometry checks](output/blender/validation-finished.json)
- [GLB reimport and door motion checks](output/blender/validation-roundtrip.json)
- [Saved configuration checks](output/blender/validation-configurations.json)

The Blender pilot scope in `requirements.pdf` is complete within the documented visual modeling assumptions. Exact manufacturer component drawings and installation clearances are not supplied. The separate full MVP asset list is also not supplied. Browser implementation and device performance testing are the next stage.

The archive `output/sauna-blender-delivery.zip` contains the finished master, four configurations, all eight GLBs, packed-source texture files, seven inspection images, validation reports, specification, and reproduction scripts. Extract the ZIP before opening the Blender files. The Windows launcher uses this machine's Blender 5.1 installation path; on another machine, open the `.blend` files directly....
