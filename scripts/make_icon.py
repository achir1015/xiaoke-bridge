# 產生程式圖示：小柯機器人＋一手扇形橋牌（黑桃 A、紅心 K）
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024


def font(size):
    for f in ('C:/Windows/Fonts/timesbd.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def sym(size):
    for f in ('C:/Windows/Fonts/seguisym.ttf', '/System/Library/Fonts/Apple Symbols.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def layer():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


def card(rank, suit, color, angle, cx, cy, back=False):
    w, h = 400, 580
    c = Image.new('RGBA', (w + 40, h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((20, 20, 20 + w, 20 + h), 44, fill=(254, 252, 244, 255), outline=(190, 180, 160, 255), width=5)
    if back:
        d.rounded_rectangle((44, 44, w - 4, h - 4), 26, fill=(26, 74, 140, 255))
    else:
        d.text((56, 34), rank, font=font(120), fill=color)
        d.text((62, 150), suit, font=sym(104), fill=color)
        d.text((20 + w / 2 + 30, 20 + h / 2 + 50), suit, font=sym(300), fill=color, anchor='mm')
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sh.paste(c, (cx - c.width // 2, cy - c.height // 2), c)
    return sh.rotate(angle, resample=Image.BICUBIC, center=(cx, cy + 300))


img = layer()
# 圓角綠底牌桌
bg = layer()
d = ImageDraw.Draw(bg)
d.rounded_rectangle((36, 36, 988, 988), 190, fill=(92, 56, 28, 255))
d.rounded_rectangle((70, 70, 954, 954), 164, fill=(22, 112, 74, 255))
img = Image.alpha_composite(img, bg)

# 三張扇形的牌
for args in [('Q', '♣', (24, 28, 40, 255), 26, 340, 470), ('K', '♥', (204, 24, 44, 255), 6, 410, 430), ('A', '♠', (20, 24, 36, 255), -16, 490, 450)]:
    c = card(*args)
    shade = c.split()[3].filter(ImageFilter.GaussianBlur(14)).point(lambda p: p * 0.45)
    img = Image.alpha_composite(img, Image.merge('RGBA', (*[Image.new('L', (S, S), 0)] * 3, shade)))
    img = Image.alpha_composite(img, c)

# 小柯機器人（頭盔造型）
rb = layer()
r = ImageDraw.Draw(rb)
cx, cy = 690, 690
r.line((cx, cy - 250, cx, cy - 190), fill=(90, 100, 120, 255), width=18)
r.ellipse((cx - 34, cy - 290, cx + 34, cy - 222), fill=(255, 196, 40, 255))
r.rounded_rectangle((cx - 262, cy - 70, cx - 210, cy + 80), 22, fill=(40, 120, 220, 255))
r.rounded_rectangle((cx + 210, cy - 70, cx + 262, cy + 80), 22, fill=(40, 120, 220, 255))
r.ellipse((cx - 230, cy - 210, cx + 230, cy + 220), fill=(70, 150, 240, 255))
r.ellipse((cx - 214, cy - 196, cx + 214, cy + 200), fill=(240, 246, 255, 255))
r.rounded_rectangle((cx - 170, cy - 110, cx + 170, cy + 90), 90, fill=(24, 36, 64, 255))
for ex in (cx - 72, cx + 72):
    r.arc((ex - 46, cy - 50, ex + 46, cy + 30), 200, 340, fill=(90, 230, 255, 255), width=22)
r.arc((cx - 50, cy + 10, cx + 50, cy + 70), 20, 160, fill=(90, 230, 255, 255), width=14)
r.ellipse((cx - 160, cy + 40, cx - 110, cy + 80), fill=(255, 140, 160, 200))
r.ellipse((cx + 110, cy + 40, cx + 160, cy + 80), fill=(255, 140, 160, 200))
sh2 = layer()
ImageDraw.Draw(sh2).ellipse((cx - 240, cy - 190, cx + 260, cy + 260), fill=(0, 0, 0, 130))
img = Image.alpha_composite(img, sh2.filter(ImageFilter.GaussianBlur(24)))
img = Image.alpha_composite(img, rb)

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
img.save(os.path.join(ROOT, 'build', 'icon.png'))
img.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('icon ok')
