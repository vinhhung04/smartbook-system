"""Copy the rendered brand assets into apps/web and apps/mobile.

    python assets/branding/scripts/build_svgs.py
    node   assets/branding/scripts/render.cjs
    python assets/branding/scripts/sync_apps.py

Needs Pillow (favicon.ico, the solid Android background layer and sizing checks).
"""
import json
import os
import shutil

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
PNG, LOGO = os.path.join(ROOT, 'png'), os.path.join(ROOT, 'logo')
WEB, MOBILE = os.path.join(REPO, 'apps', 'web', 'public'), os.path.join(REPO, 'apps', 'mobile', 'assets')
INK = json.load(open(os.path.join(ROOT, 'brand-tokens.json'), encoding='utf-8'))['color']['ink']['value']


def copy(src, dst):
    shutil.copyfile(src, dst)
    print(os.path.relpath(dst, REPO))


def main():
    # favicon.ico carries the pixel-rendered 16/32/48 sizes, not one downscaled image.
    ico = os.path.join(PNG, 'favicon.ico')
    sizes = [Image.open(os.path.join(PNG, f'favicon-{s}.png')) for s in (48, 32, 16)]
    sizes[0].save(ico, format='ICO', sizes=[(48, 48), (32, 32), (16, 16)], append_images=sizes[1:])

    # Android adaptive background: the Ink tile as a flat layer.
    bg = os.path.join(PNG, 'android-background-1024.png')
    Image.new('RGB', (1024, 1024), INK).save(bg)

    # iOS rejects icons with an alpha channel.
    icon = Image.open(os.path.join(PNG, 'app-icon-1024.png')).convert('RGB')
    icon.save(os.path.join(PNG, 'app-icon-1024.png'))
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(PNG, 'icon-maskable-512.png'))

    copy(os.path.join(LOGO, 'smartbook-favicon.svg'), os.path.join(WEB, 'favicon.svg'))
    copy(ico, os.path.join(WEB, 'favicon.ico'))
    copy(os.path.join(PNG, 'apple-touch-icon-180.png'), os.path.join(WEB, 'apple-touch-icon.png'))
    copy(os.path.join(PNG, 'favicon-192.png'), os.path.join(WEB, 'icon-192.png'))
    copy(os.path.join(PNG, 'favicon-512.png'), os.path.join(WEB, 'icon-512.png'))
    copy(os.path.join(PNG, 'icon-maskable-512.png'), os.path.join(WEB, 'icon-maskable-512.png'))
    copy(os.path.join(PNG, 'og-image-1200x630.png'), os.path.join(WEB, 'og-image.png'))

    copy(os.path.join(PNG, 'app-icon-1024.png'), os.path.join(MOBILE, 'icon.png'))
    copy(os.path.join(PNG, 'android-foreground-1024.png'), os.path.join(MOBILE, 'android-icon-foreground.png'))
    copy(bg, os.path.join(MOBILE, 'android-icon-background.png'))
    copy(os.path.join(PNG, 'android-monochrome-1024.png'), os.path.join(MOBILE, 'android-icon-monochrome.png'))
    copy(os.path.join(PNG, 'splash-icon-1024.png'), os.path.join(MOBILE, 'splash-icon.png'))
    copy(os.path.join(PNG, 'favicon-48.png'), os.path.join(MOBILE, 'favicon.png'))


if __name__ == '__main__':
    main()
