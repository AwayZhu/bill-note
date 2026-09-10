#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成记账 App 的启动图标（¥ 货币符号，暖橙底白字）。

产出两类资源，写入 android/app/src/main/res/mipmap-*：
  1) ic_launcher_foreground.png  —— 透明底 + 白色 ¥（Android 8.0+ 自适应图标前景）
  2) ic_launcher.png / ic_launcher_round.png —— 橙色圆角方块 + 白色 ¥（老系统整图）

背景色统一在 res/values/ic_launcher_background.xml 里改（本脚本不管，改完重打包即可）。
"""
import os
from PIL import Image, ImageDraw, ImageFont

# ---- 可调参数 ----
BG = (0xF5, 0x9E, 0x0B, 255)        # 图标底色：暖橙 amber #F59E0B
FG = (255, 255, 255, 255)           # 字形颜色：白
GLYPH = "¥"
FONT = r"C:/Windows/Fonts/msyhbd.ttc"   # 微软雅黑粗体（含 ¥）

RES = r"D:/workbuddy工作空间存储目录/我的App-记账/android/app/src/main/res"

# 自适应前景画布 = 108dp；老系统整图 = 48dp。按密度放大。
DENSITIES = {
    "mdpi":     {"fg": 108, "legacy": 48},
    "hdpi":     {"fg": 162, "legacy": 72},
    "xhdpi":    {"fg": 216, "legacy": 96},
    "xxhdpi":   {"fg": 324, "legacy": 144},
    "xxxhdpi":  {"fg": 432, "legacy": 192},
}


def load_font(px):
    return ImageFont.truetype(FONT, px)


def make_foreground(size):
    """透明底 + 居中白色 ¥，内容控制在安全区内（约 0.6 画布宽）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = load_font(int(size * 0.66))
    l, t, r, b = d.textbbox((0, 0), GLYPH, font=font)
    w, h = r - l, b - t
    x = (size - w) / 2 - l
    y = (size - h) / 2 - t
    d.text((x, y), GLYPH, font=font, fill=FG)
    return img


def make_legacy(size):
    """橙色圆角方块 + 居中白色 ¥。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.22)
    d.rounded_rectangle([0, 0, size, size], radius=radius, fill=BG)
    font = load_font(int(size * 0.62))
    l, t, r, b = d.textbbox((0, 0), GLYPH, font=font)
    w, h = r - l, b - t
    x = (size - w) / 2 - l
    y = (size - h) / 2 - t
    d.text((x, y), GLYPH, font=font, fill=FG)
    return img


def main():
    if not os.path.exists(FONT):
        raise SystemExit(f"找不到字体：{FONT}")
    for dens, sz in DENSITIES.items():
        d = os.path.join(RES, f"mipmap-{dens}")
        fg = make_foreground(sz["fg"])
        fg.save(os.path.join(d, "ic_launcher_foreground.png"))
        leg = make_legacy(sz["legacy"])
        leg.save(os.path.join(d, "ic_launcher.png"))
        leg.save(os.path.join(d, "ic_launcher_round.png"))
        print(f"  {dens:8s} fg={sz['fg']}px  legacy={sz['legacy']}px  -> 写好了")
    print("图标生成完成。")


if __name__ == "__main__":
    main()
