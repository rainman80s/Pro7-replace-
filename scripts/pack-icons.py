"""Pack resources/icon.png into icon.icns (macOS) and icon-square.png into icon.ico (Windows). Needs Pillow."""
from pathlib import Path
from PIL import Image
r = Path(__file__).resolve().parent.parent / 'resources'
mac = Image.open(r / 'icon.png').convert('RGBA')
mac.save(r / 'icon.icns', sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
sq = Image.open(r / 'icon-square.png').convert('RGBA')
sq.save(r / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
sq.resize((512, 512), Image.LANCZOS).save(r / 'icon-512.png')
print('ok', [p.name for p in sorted(r.iterdir())])
