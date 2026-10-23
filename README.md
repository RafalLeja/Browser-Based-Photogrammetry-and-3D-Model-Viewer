## Dependencies

1. Colmap

   On Debian:

   ```bash
   sudo apt install colmap
   ```

2. OpenMVS
   [https://github.com/cdcseacave/openMVS/releases]

3. Images
   [https://support.pix4d.com/hc/en-us/articles/360000235126]

## How to run

```bash
uv run reconstruction.py --images <path_to_images> --output <path_to_output>
```

Example (assuming you have downloaded the images and placed them in `./images/eagle/images`):

```bash
uv run reconstruction.py --images ./images/eagle/images --output ./images/eagle/output
```
