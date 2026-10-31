# -*- coding: utf-8 -*-
"""
小柯機器人橋牌競賽：背景音樂產生器（原創、程序合成，無版權疑慮）
以沙龍爵士與輕古典風格自動作曲：鋼琴、木貝斯、顫音琴、弦樂、長笛與刷鼓，
輸出 20 首約 3 分 10 秒～3 分 40 秒的 MP3 到 assets/music/。

用法：python scripts/gen_music.py [曲目編號...]
"""
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'music')

# 和弦（根音半音數、音程）
Q = {
    'maj7': [0, 4, 7, 11], 'min7': [0, 3, 7, 10], 'dom7': [0, 4, 7, 10], 'm7b5': [0, 3, 6, 10],
    'maj6': [0, 4, 7, 9], 'min6': [0, 3, 7, 9], 'sus': [0, 5, 7, 10], 'dim7': [0, 3, 6, 9],
}
# 級數進行：(根音相對主音, 和弦性質)
PROG = {
    'twofive': [(2, 'min7'), (7, 'dom7'), (0, 'maj7'), (9, 'min7')],
    'turn': [(0, 'maj7'), (9, 'min7'), (2, 'min7'), (7, 'dom7')],
    'fall': [(4, 'min7'), (9, 'dom7'), (2, 'min7'), (7, 'dom7')],
    'minor': [(0, 'min7'), (5, 'min7'), (10, 'dom7'), (3, 'maj7')],
    'minor2': [(0, 'min6'), (8, 'maj7'), (2, 'm7b5'), (7, 'dom7')],
    'wistful': [(5, 'maj7'), (4, 'min7'), (2, 'min7'), (7, 'sus')],
    'bright': [(0, 'maj6'), (5, 'maj7'), (2, 'min7'), (7, 'dom7')],
}
SCALE_MAJ = [0, 2, 4, 5, 7, 9, 11]
SCALE_MIN = [0, 2, 3, 5, 7, 8, 10]

# 名稱、速度、主音(MIDI)、A 段進行、B 段進行、主奏 A、主奏 B、打擊(0-2)、密度(0-2)、拍號、小調、搖擺
TRACKS = [
    ('開叫時刻', 112, 60, 'twofive', 'turn', 'vibes', 'piano', 1, 1, 4, 0, 1),
    ('無王之夜', 76, 58, 'minor', 'wistful', 'piano', 'strings', 1, 0, 4, 1, 1),
    ('飛牌', 128, 62, 'fall', 'twofive', 'flute', 'vibes', 2, 2, 4, 0, 1),
    ('王牌在手', 104, 65, 'bright', 'turn', 'piano', 'flute', 1, 1, 4, 0, 1),
    ('夢幻明手', 68, 63, 'wistful', 'fall', 'strings', 'piano', 0, 0, 4, 0, 0),
    ('大滿貫', 136, 60, 'turn', 'bright', 'piano', 'vibes', 2, 2, 4, 0, 1),
    ('小滿貫', 118, 67, 'bright', 'fall', 'vibes', 'flute', 2, 1, 4, 0, 1),
    ('首攻', 96, 57, 'minor2', 'minor', 'flute', 'piano', 1, 1, 4, 1, 1),
    ('夥伴默契', 84, 62, 'twofive', 'wistful', 'piano', 'strings', 1, 1, 3, 0, 0),
    ('紅心皇后', 72, 65, 'wistful', 'turn', 'flute', 'strings', 0, 0, 3, 0, 0),
    ('黑桃 A', 124, 55, 'minor', 'minor2', 'vibes', 'piano', 2, 2, 4, 1, 1),
    ('方塊舞曲', 132, 69, 'bright', 'twofive', 'flute', 'piano', 2, 2, 3, 0, 0),
    ('梅花圓舞曲', 108, 60, 'turn', 'wistful', 'strings', 'flute', 1, 1, 3, 0, 0),
    ('賭倍', 142, 58, 'minor2', 'fall', 'piano', 'vibes', 2, 2, 4, 1, 1),
    ('再賭倍', 150, 62, 'fall', 'minor', 'vibes', 'piano', 2, 2, 4, 1, 1),
    ('贏墩計算', 100, 63, 'twofive', 'bright', 'vibes', 'piano', 1, 1, 4, 0, 1),
    ('清王', 90, 64, 'minor', 'fall', 'piano', 'flute', 1, 1, 4, 1, 1),
    ('安全打法', 66, 60, 'wistful', 'twofive', 'strings', 'piano', 0, 0, 4, 0, 0),
    ('週末橋牌會', 116, 65, 'bright', 'turn', 'piano', 'vibes', 1, 2, 4, 0, 1),
    ('圓滿收局', 74, 60, 'twofive', 'wistful', 'piano', 'strings', 0, 0, 3, 0, 0),
]
TARGET_SEC = (196, 222)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, a, d, s, r):
    e = np.ones(n) * s
    a = max(1, int(a * SR)); d = max(1, int(d * SR)); r = max(1, min(int(r * SR), n // 2))
    a = min(a, n // 3); d = min(d, n // 3)
    e[:a] = np.linspace(0, 1, a)
    e[a:a + d] = np.linspace(1, s, d)
    e[-r:] *= np.linspace(1, 0, r)
    return e


def piano(m, dur, vel):
    n = int(SR * min(dur + 1.0, 5))
    t = np.arange(n) / SR
    f = hz(m)
    y = np.zeros(n)
    for k, (a, dec) in enumerate([(1, 2.6), (.55, 3.6), (.3, 5), (.16, 7), (.1, 9), (.05, 12)], 1):
        inh = 1 + 0.00035 * k * k
        y += a * np.exp(-t * dec * (0.6 + f / 900)) * np.sin(2 * np.pi * f * k * inh * t + k)
    click = np.exp(-t * 180) * 0.2 * np.sin(2 * np.pi * f * 7 * t)
    return (y + click) * vel * 0.22 * np.minimum(1, (n - np.arange(n)) / (0.05 * SR))


def vibes(m, dur, vel):
    n = int(SR * min(dur + 1.6, 4.5))
    t = np.arange(n) / SR
    f = hz(m)
    trem = 1 + 0.28 * np.sin(2 * np.pi * 5.2 * t)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t * 1.3) + 0.35 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 6) + 0.12 * np.sin(2 * np.pi * f * 10 * t) * np.exp(-t * 18)
    return y * trem * vel * 0.2


def flute(m, dur, vel):
    n = int(SR * (dur + 0.12))
    t = np.arange(n) / SR
    f = hz(m)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.4 * t) * np.minimum(1, t / 0.35)
    ph = 2 * np.pi * f * np.cumsum(vib) / SR
    y = np.sin(ph) + 0.28 * np.sin(2 * ph) + 0.1 * np.sin(3 * ph)
    y += 0.02 * np.random.default_rng(m).standard_normal(n)
    return y * env(n, 0.05, 0.08, 0.8, 0.09) * vel * 0.17


def strings(m, dur, vel):
    n = int(SR * (dur + 0.4))
    t = np.arange(n) / SR
    f = hz(m)
    y = np.zeros(n)
    for det in (-0.004, 0, 0.0035):
        ph = 2 * np.pi * f * (1 + det) * t + np.sin(2 * np.pi * 4.8 * t) * 0.09
        for k, a in ((1, 1), (2, .5), (3, .3), (4, .16), (5, .08)):
            y += a * np.sin(k * ph)
    return y * env(n, 0.22, 0.15, 0.85, 0.35) * vel * 0.055


def bass(m, dur, vel):
    n = int(SR * (dur + 0.25))
    t = np.arange(n) / SR
    f = hz(m)
    y = np.sin(2 * np.pi * f * t) + 0.45 * np.sin(4 * np.pi * f * t) * np.exp(-t * 3) + 0.2 * np.sin(6 * np.pi * f * t) * np.exp(-t * 7)
    return y * np.exp(-t * 1.8) * np.minimum(1, t / 0.008) * env(n, 0.002, 0.01, 1, 0.08) * vel * 0.42


def brush(dur, vel, rng, hi=False):
    n = int(SR * dur)
    y = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * (55 if hi else 16))
    sos = butter(2, [4500 if hi else 1500, 11000], btype='band', fs=SR, output='sos')
    return sosfilt(sos, y) * vel * 0.07


def ride(vel, rng):
    n = int(SR * 0.6)
    t = np.arange(n) / SR
    y = sum(np.sin(2 * np.pi * f * t) for f in (3120, 4470, 5310, 6620)) * 0.25 * np.exp(-t * 7)
    y += rng.standard_normal(n) * 0.2 * np.exp(-t * 24)
    return y * vel * 0.05


def kick(vel):
    n = int(SR * 0.22)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * (52 + 70 * np.exp(-t * 34)) * t) * np.exp(-t * 15) * vel * 0.3


VOICES = {'piano': piano, 'vibes': vibes, 'flute': flute, 'strings': strings}


class Song:
    def __init__(self, idx, cfg):
        self.idx = idx
        (self.title, self.bpm, self.key, self.pa, self.pb, self.la, self.lb, self.drums, self.dens, self.meter, self.minor, self.swing) = cfg
        self.rng = np.random.default_rng(4242 + idx * 97)
        self.beat = 60.0 / self.bpm
        target = self.rng.uniform(*TARGET_SEC)
        self.bars = int(target / (self.beat * self.meter)) + 2
        self.total = self.bars * self.meter * self.beat + 7
        self.tracks = {k: np.zeros((int(self.total * SR) + SR, 2)) for k in ('rhythm', 'lead', 'pad', 'drums')}

    def put(self, bus, y, t, pan=0.0):
        i = int(t * SR)
        buf = self.tracks[bus]
        n = min(len(y), len(buf) - i)
        if n <= 0:
            return
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        buf[i:i + n, 0] += y[:n] * l
        buf[i:i + n, 1] += y[:n] * r

    def sw(self, pos):
        # 搖擺八分音符：反拍往後推
        if self.swing and abs(pos % 1 - 0.5) < 0.01:
            return pos + 0.16
        return pos

    def chord_at(self, section, bar):
        prog = PROG[self.pa if section == 'A' else self.pb]
        return prog[bar % len(prog)]

    def compose(self):
        # 曲式：前奏 A A B A … 收尾
        phrase = 8
        form = []
        sections = ['A', 'A', 'B', 'A']
        while len(form) < self.bars - 2:
            for s in sections:
                form += [s] * phrase
        form = form[:self.bars - 2]
        scale = SCALE_MIN if self.minor else SCALE_MAJ
        mel_center = self.key + 12
        degree = 2
        for b, sec in enumerate(form):
            t0 = b * self.meter * self.beat + 0.2
            root, q = self.chord_at(sec, b)
            notes = [self.key + root + x for x in Q[q]]
            intro = b < 4
            outro = b >= len(form) - 4
            self.comp(t0, notes, sec, intro)
            self.walk(t0, self.key + root - 24, form, b)
            if self.drums and not intro:
                self.drum(t0, b)
            if sec == 'B' or self.dens == 0:
                for n in notes[:3]:
                    self.put('pad', strings(n, self.meter * self.beat, 0.8), t0, self.rng.uniform(-.5, .5))
            if not intro and not outro:
                degree = self.melody(t0, sec, b, scale, mel_center, notes, degree)
        # 結尾和弦
        t0 = (self.bars - 2) * self.meter * self.beat + 0.2
        for n in [self.key - 12, self.key, self.key + 7, self.key + 12, self.key + 16 - (1 if self.minor else 0)]:
            self.put('rhythm', piano(n, 5, 0.75), t0, self.rng.uniform(-.3, .3))
            self.put('pad', strings(n, 5, 0.7), t0, 0)

    def comp(self, t0, notes, sec, intro):
        # 鋼琴伴奏：切分和弦
        patterns = {4: [[0, 1.5, 3], [0.5, 2, 3.5], [0, 2.5], [1.5, 3]], 3: [[0, 1, 2], [0, 1.5], [1, 2]]}
        pat = patterns[self.meter][self.rng.integers(len(patterns[self.meter]))]
        if self.dens == 0:
            pat = pat[:2]
        for p in pat:
            vel = self.rng.uniform(0.32, 0.5) * (1.1 if p == 0 else 1)
            voiced = [n + (12 if n < 60 else 0) for n in notes]
            for j, n in enumerate(sorted(voiced)):
                self.put('rhythm', piano(n, self.beat * 1.2, vel), t0 + self.sw(p) * self.beat + j * 0.006, -0.25 + j * 0.05)

    def walk(self, t0, base, form, b):
        # 木貝斯走路：拍點上走和弦內音與經過音
        if self.meter == 3 or self.bpm < 80:
            self.put('rhythm', bass(base, self.beat * 1.8, 0.9), t0, 0)
            self.put('rhythm', bass(base + 7, self.beat * 1.2, 0.7), t0 + (self.meter - 1) * self.beat, 0)
            return
        cand = [0, 3 if self.minor else 4, 7, 10, 12, 5]
        nxt = self.chord_at(form[min(b + 1, len(form) - 1)], b + 1)[0] + self.key - 24
        for i in range(4):
            if i == 0:
                n = base
            elif i == 3:
                n = nxt + (1 if self.rng.random() < .5 else -1)
            else:
                n = base + cand[self.rng.integers(len(cand))]
            self.put('rhythm', bass(n, self.beat * 0.95, self.rng.uniform(.75, .95)), t0 + i * self.beat, 0.05)

    def drum(self, t0, b):
        for i in range(self.meter):
            t = t0 + i * self.beat
            self.put('drums', ride(0.8, self.rng), t, 0.3)
            if self.swing and self.drums >= 2 and i % 2 == 1:
                self.put('drums', ride(0.5, self.rng), t + 0.66 * self.beat, 0.3)
            if i % 2 == 1:
                self.put('drums', brush(0.28, 1.0, self.rng), t, -0.2)
            if i == 0 and self.drums >= 2:
                self.put('drums', kick(0.7), t, 0)
            if self.drums >= 1:
                self.put('drums', brush(0.06, 0.6, self.rng, True), t + 0.5 * self.beat, 0.15)

    def melody(self, t0, sec, b, scale, center, notes, degree):
        # 樂句：每 8 小節重複主題動機，變化落點
        lead = VOICES[self.la if sec == 'A' else self.lb]
        rhythms = {
            4: [[0, 1, 2.5], [0.5, 1.5, 3], [0, 1.5, 2, 3], [1, 2.5], [0, 0.5, 1, 2, 3]],
            3: [[0, 1, 2], [0, 1.5], [0.5, 1, 2], [0, 2]],
        }[self.meter]
        rs = np.random.default_rng(self.idx * 1000 + (b % 8) * 13 + (0 if sec == 'A' else 500))
        rhy = rhythms[rs.integers(len(rhythms))]
        if self.dens == 0 and len(rhy) > 2:
            rhy = rhy[:2]
        if b % 8 == 7:
            rhy = rhy[:1]  # 樂句收尾留白
        for i, p in enumerate(rhy):
            next_p = rhy[i + 1] if i + 1 < len(rhy) else self.meter
            degree += int(self.rng.choice([-2, -1, -1, 1, 1, 2]))
            degree = int(np.clip(degree, -3, 10))
            octv, deg = divmod(degree, len(scale))
            m = center + scale[deg] + 12 * octv
            if i == 0:  # 強拍落在和弦音
                cands = [n + 12 * round((m - n) / 12) for n in notes]
                m = min(cands, key=lambda x: abs(x - m))
            dur = (next_p - p) * self.beat * 0.95
            self.put('lead', lead(m, dur, self.rng.uniform(0.75, 0.98)), t0 + self.sw(p) * self.beat, 0.12)
        return degree

    def render(self):
        n = min(len(v) for v in self.tracks.values())
        # 餘響
        L = int(1.6 * SR)
        rng = np.random.default_rng(self.idx + 7)
        ir = rng.standard_normal((L, 2)) * np.exp(-np.arange(L)[:, None] / SR * 3.6)
        ir[: int(0.012 * SR)] = 0
        mix = np.zeros((n, 2))
        for bus, g, wet in (('rhythm', 0.8, 0.14), ('lead', 1.0, 0.24), ('pad', 0.8, 0.3), ('drums', 0.8, 0.08)):
            x = self.tracks[bus][:n] * g
            rv = np.stack([fftconvolve(x[:, c], ir[:, c])[:n] for c in (0, 1)], axis=1)
            rv *= 0.05 * wet / 0.14
            mix += x + rv
        sos = butter(2, 40, btype='high', fs=SR, output='sos')
        mix = sosfilt(sos, mix, axis=0)
        end = int((self.bars * self.meter * self.beat + 4) * SR)
        mix = mix[:min(end, n)]
        rms = np.sqrt(np.mean(mix ** 2)) + 1e-9
        mix *= 10 ** (-20.0 / 20) / rms
        mix = np.tanh(mix * 1.1) / 1.1
        peak = np.max(np.abs(mix))
        if peak > 0.89:
            mix *= 0.89 / peak
        fi = int(0.05 * SR); fo = int(4.0 * SR)
        mix[:fi] *= np.linspace(0, 1, fi)[:, None]
        mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
        return mix


def build(idx):
    cfg = TRACKS[idx]
    song = Song(idx, cfg)
    song.compose()
    mix = song.render()
    name = f'track{idx + 1:02d}.mp3'
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, 'x.wav')
        wavfile.write(wav, SR, (mix * 32767).astype(np.int16))
        subprocess.run([
            'ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k',
            '-id3v2_version', '3', '-metadata', f'title={cfg[0]}', '-metadata', 'artist=小柯機器人',
            '-metadata', 'album=小柯機器人橋牌競賽 背景音樂', '-metadata', f'track={idx + 1}',
            os.path.join(OUT, name),
        ], check=True)
    return {'file': name, 'title': cfg[0], 'seconds': round(len(mix) / SR, 1)}


def main():
    os.makedirs(OUT, exist_ok=True)
    which = [int(a) - 1 for a in sys.argv[1:]] or list(range(len(TRACKS)))
    with ProcessPoolExecutor(max_workers=max(2, (os.cpu_count() or 4) // 2)) as ex:
        results = list(ex.map(build, which))
    meta_path = os.path.join(OUT, 'tracks.json')
    meta = {}
    if os.path.exists(meta_path):
        for t in json.load(open(meta_path, encoding='utf-8')):
            meta[t['file']] = t
    for r in results:
        meta[r['file']] = r
        print(r['file'], r['title'], r['seconds'], 's')
    json.dump(sorted(meta.values(), key=lambda x: x['file']), open(meta_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
