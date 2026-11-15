from PIL import Image, ImageDraw, ImageFont
import os, sys
from PIL import PngImagePlugin
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
F = r"C:\Windows\Fonts\arial.ttf"
FB = r"C:\Windows\Fonts\arialbd.ttf"
FG = r"C:\Windows\Fonts\georgiab.ttf"

def font(p, s):
    return ImageFont.truetype(p, s)

# front cover
img = Image.new('RGB', (1000, 1500), (26, 54, 93))
d = ImageDraw.Draw(img)
d.rectangle([60, 60, 940, 1440], outline=(214, 180, 106), width=6)
d.text((500, 380), "HARUKI", font=font(FG, 70), fill=(240, 232, 214), anchor='mm')
d.text((500, 470), "MURAKAMI", font=font(FG, 70), fill=(240, 232, 214), anchor='mm')
d.line([300, 560, 700, 560], fill=(214, 180, 106), width=4)
d.text((500, 700), "Norwegian", font=font(FG, 110), fill=(255, 255, 255), anchor='mm')
d.text((500, 830), "Wood", font=font(FG, 110), fill=(255, 255, 255), anchor='mm')
d.text((500, 960), "A Novel", font=font(F, 48), fill=(214, 180, 106), anchor='mm')
d.text((500, 1330), "VINTAGE INTERNATIONAL", font=font(FB, 40), fill=(240, 232, 214), anchor='mm')
img.save(os.path.join(out, 'test-front-cover.png'), format='PNG')

# copyright page
img = Image.new('RGB', (1000, 1500), (250, 248, 242))
d = ImageDraw.Draw(img)
lines = [
    (F, 34, "FIRST VINTAGE INTERNATIONAL EDITION, SEPTEMBER 2000"),
    (F, 30, ""),
    (F, 30, "Translation copyright (c) 2000 by Haruki Murakami"),
    (F, 30, "Translated from the Japanese by Jay Rubin"),
    (F, 30, ""),
    (F, 30, "All rights reserved. Published in the United States"),
    (F, 30, "by Vintage Books, a division of Random House, Inc."),
    (F, 30, ""),
    (F, 30, "Library of Congress Cataloging-in-Publication Data"),
    (F, 30, "Murakami, Haruki."),
    (F, 30, "Norwegian wood / Haruki Murakami ; translated by Jay Rubin."),
    (F, 30, "p. cm.  296 pages"),
    (F, 30, ""),
    (FB, 36, "ISBN 978-0-375-70402-4"),
    (F, 30, ""),
    (F, 30, "www.vintagebooks.com"),
    (F, 30, "Printed in the United States of America"),
]
y = 260
for p, s, t in lines:
    d.text((110, y), t, font=font(p, s), fill=(30, 30, 30))
    y += 62
img.save(os.path.join(out, 'test-copyright-page.png'), format='PNG')
print('ok')


