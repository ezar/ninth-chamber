"""
Builds the game's recorded audio (spec §12 "Producción") from openly licensed
sources: downloads them, slices, cleans, levels and encodes every sample to
Opus in WebM under public/audio/<category>/, and writes

- src/audio/samples.json: the bank manifest the engine loads (bank -> files),
- public/audio/CREDITS.md: every file with its source, author and licence.

Sources (all CC0 except the music, CC-BY 4.0):
- Freesound.org sounds (the HQ previews of CC0 uploads, whose licence is
  checked on the sound page at download time),
- Kenney's "Impact Sounds", "RPG Audio" and "Interface Sounds" packs (CC0),
- Kevin MacLeod's music from incompetech.com (CC-BY 4.0).

Processing: mono for everything positional, high-pass against handling
rumble, silence trimmed, short fades, loops cross-faded into themselves,
banks levelled together to about -18 LUFS (sfx, max momentary loudness for
one-shots) or -20 LUFS (music and ambience) with a -1.5 dBFS peak ceiling.

Usage (Python 3.10+, `pip install numpy scipy pyloudnorm imageio-ffmpeg`):
    python scripts/audio/build_audio.py [--cache DIR] [--only BANK,...]

The download cache defaults to scripts/audio/.cache (git-ignored).
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from dataclasses import dataclass, field
from fractions import Fraction

import numpy as np
import pyloudnorm as pyln
from scipy import ndimage, signal

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'audio')
MANIFEST = os.path.join(ROOT, 'src', 'audio', 'samples.json')
SR = 48000
CEILING_DB = -1.5
UA = {'User-Agent': 'Mozilla/5.0 (ninth-chamber audio build)'}


def ffmpeg_bin() -> str:
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit('ffmpeg not found: install it or `pip install imageio-ffmpeg`.')


FFMPEG = ffmpeg_bin()

# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

KENNEY = {
    'impact': ('Impact Sounds', 'https://kenney.nl/assets/impact-sounds',
               'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip'),
    'rpg': ('RPG Audio', 'https://kenney.nl/assets/rpg-audio',
            'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip'),
    'interface': ('Interface Sounds', 'https://kenney.nl/assets/interface-sounds',
                  'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip'),
}

# Kevin MacLeod, incompetech.com (CC-BY 4.0): title, ISRC (the piece's page).
INCOMPETECH = {
    'tempting-secrets': ('Tempting Secrets', 'USUAN1300038'),
    'lost-frontier': ('Lost Frontier', 'USUAN1300039'),
    'arcadia': ('Arcadia', 'USUAN1100326'),
    'hero-theme': ('Hero Theme', 'USUAN1100491'),
    'curse-of-the-scarab': ('Curse of the Scarab', 'USUAN1600014'),
    'oppressive-gloom': ('Oppressive Gloom', 'USUAN1100885'),
    'mirage': ('Mirage', 'USUAN1100877'),
    'constance': ('Constance', 'USUAN1100850'),
    'long-note-three': ('Long Note Three', 'USUAN1100424'),
    'mistake-the-getaway': ('Mistake the Getaway', 'USUAN1100699'),
    'enter-the-maze': ('Enter the Maze', 'USUAN1100782'),
    'final-battle': ('Final Battle of the Dark Wizards', 'USUAN1500085'),
    'mystery-sting': ('Mystery Sting', 'USUAN1100430'),
    'discovery-hit': ('Discovery Hit', 'USUAN1300023'),
    'greta-sting': ('Greta Sting', 'USUAN1100530'),
    'big-hit-1': ('Danse Macabre - Big Hit 1', 'USUAN1100558'),
    'big-hit-2': ('Danse Macabre - Big Hit 2', 'USUAN1100557'),
    'darkness-speaks': ('Darkness Speaks', 'USUAN1100364'),
    'curtain-rises': ('The Curtain Rises', 'USUAN1500011'),
}

# Scott Buckley, scottbuckley.com.au/library (CC-BY 4.0; games are covered with credit): title, page, file.
SB = 'https://www.scottbuckley.com.au/library/'
SB_FILES = SB + 'wp-content/uploads/'
SCOTT_BUCKLEY = {
    'age-of-wonder': ('Age of Wonder', SB + 'age-of-wonder/', SB_FILES + '2022/03/AgeOfWonder.mp3'),
    'memories-of-stone': ('Memories Of Stone', SB + 'memories-of-stone/', SB_FILES + '2026/02/MemoriesOfStone.mp3'),
    'passage-of-time': ('Passage of Time', SB + 'passage-of-time/', SB_FILES + '2022/01/PassageOfTime.mp3'),
    'hymn-to-the-dawn': ('Hymn to the Dawn', SB + 'hymn-to-the-dawn/', SB_FILES + '2022/11/HymnToTheDawn.mp3'),
    'goliath': ('Goliath', SB + 'goliath/', SB_FILES + '2021/08/sb_goliath.mp3'),
    'victor-lux': ('Victor Lux', SB + 'victor-lux/', SB_FILES + '2023/05/VictorLux.mp3'),
    'the-great-sea': ('The Great Sea', SB + 'the-great-sea/', SB_FILES + '2024/01/TheGreatSea.mp3'),
    'permafrost': ('Permafrost', SB + 'permafrost/', SB_FILES + '2022/08/Permafrost.mp3'),
    'decoherence': ('Decoherence', SB + 'decoherence/', SB_FILES + '2022/03/sb_decoherence.mp3'),
    'juggernaut': ('Juggernaut', SB + 'juggernaut/', SB_FILES + '2022/07/Juggernaut.mp3'),
}


@dataclass
class Source:
    key: str
    title: str
    url: str
    author: str
    license: str
    license_url: str
    path: str


class Sources:
    def __init__(self, cache: str) -> None:
        self.cache = cache
        os.makedirs(cache, exist_ok=True)
        self.meta_path = os.path.join(cache, 'meta.json')
        self.meta: dict[str, dict[str, str]] = (
            json.load(open(self.meta_path)) if os.path.exists(self.meta_path) else {}
        )
        self.used: dict[str, Source] = {}

    def _save(self) -> None:
        json.dump(self.meta, open(self.meta_path, 'w'), indent=1)

    @staticmethod
    def _get(url: str) -> tuple[str, bytes]:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.geturl(), r.read()

    def freesound(self, sid: int) -> Source:
        key = f'fs:{sid}'
        path = os.path.join(self.cache, 'freesound', f'{sid}.ogg')
        if key not in self.meta or not os.path.exists(path):
            page_url, body = self._get(f'https://freesound.org/s/{sid}/')
            h = body.decode('utf-8', 'replace')
            title = html.unescape(re.search(r'data-title="([^"]*)"', h).group(1))  # type: ignore[union-attr]
            author = re.search(r'/people/([^/]+)/', page_url).group(1)  # type: ignore[union-attr]
            ogg = re.search(r'data-ogg="([^"]*)"', h).group(1).replace('-lq.ogg', '-hq.ogg')  # type: ignore[union-attr]
            lic = re.search(r'href="(https?://creativecommons.org/[^"]+)"', h)
            lic_url = lic.group(1) if lic else ''
            if 'publicdomain/zero' in lic_url:
                lic_name = 'CC0 1.0'
            elif '/licenses/by/' in lic_url:
                lic_name = 'CC-BY ' + re.search(r'/by/([0-9.]+)', lic_url).group(1)  # type: ignore[union-attr]
            else:
                sys.exit(f'Freesound {sid}: licence {lic_url or "unknown"} is not CC0 or CC-BY')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            _, audio = self._get(ogg)
            open(path, 'wb').write(audio)
            self.meta[key] = {'title': title, 'url': page_url, 'author': author, 'license': lic_name,
                              'license_url': lic_url, 'file': ogg}
            self._save()
        m = self.meta[key]
        src = Source(key, m['title'], m['url'], m['author'], m['license'], m['license_url'], path)
        self.used[key] = src
        return src

    def kenney(self, pack: str, name: str) -> Source:
        title, page, zip_url = KENNEY[pack]
        folder = os.path.join(self.cache, 'kenney', pack)
        if not os.path.isdir(folder):
            _, data = self._get(zip_url)
            zpath = folder + '.zip'
            os.makedirs(os.path.dirname(zpath), exist_ok=True)
            open(zpath, 'wb').write(data)
            zipfile.ZipFile(zpath).extractall(folder)
        path = os.path.join(folder, 'Audio', name)
        if not os.path.exists(path):
            sys.exit(f'Kenney {pack}: missing {name}')
        key = f'kenney:{pack}'
        src = Source(key, f'{title} ({name})', page, 'Kenney (kenney.nl)', 'CC0 1.0',
                     'https://creativecommons.org/publicdomain/zero/1.0/', path)
        self.used.setdefault(key, Source(key, title, page, src.author, src.license, src.license_url, folder))
        return src

    def incompetech(self, key: str) -> Source:
        title, isrc = INCOMPETECH[key]
        path = os.path.join(self.cache, 'incompetech', f'{key}.mp3')
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            _, data = self._get('https://incompetech.com/music/royalty-free/mp3-royaltyfree/'
                                + urllib.request.quote(title) + '.mp3')
            open(path, 'wb').write(data)
        src = Source(f'inc:{key}', f'"{title}"', f'https://incompetech.com/music/royalty-free/index.html?isrc={isrc}',
                     'Kevin MacLeod (incompetech.com)', 'CC-BY 4.0',
                     'https://creativecommons.org/licenses/by/4.0/', path)
        self.used[src.key] = src
        return src

    def scottbuckley(self, key: str) -> Source:
        title, page, mp3 = SCOTT_BUCKLEY[key]
        path = os.path.join(self.cache, 'scottbuckley', f'{key}.mp3')
        meta_key = f'sb:{key}'
        if meta_key not in self.meta or not os.path.exists(path):
            _, body = self._get(page)
            text = re.sub(r'<[^>]+>', ' ', body.decode('utf-8', 'replace'))
            if 'Attribution 4.0' not in text:
                sys.exit(f'Scott Buckley {title}: the page does not state CC BY 4.0')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            _, data = self._get(mp3)
            open(path, 'wb').write(data)
            self.meta[meta_key] = {'title': title, 'url': page, 'file': mp3, 'license': 'CC-BY 4.0'}
            self._save()
        src = Source(meta_key, f'"{title}"', page, 'Scott Buckley (www.scottbuckley.com.au)', 'CC-BY 4.0',
                     'https://creativecommons.org/licenses/by/4.0/', path)
        self.used[src.key] = src
        return src

    def music(self, ref: str) -> Source:
        """'inc:<key>' (incompetech) or 'sb:<key>' (Scott Buckley)."""
        kind, key = ref.split(':', 1)
        return self.incompetech(key) if kind == 'inc' else self.scottbuckley(key)


# ---------------------------------------------------------------------------
# DSP helpers (48 kHz float64)
# ---------------------------------------------------------------------------


def load(path: str, start: float = 0, end: float | None = None, channels: int = 1) -> np.ndarray:
    cmd = [FFMPEG, '-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ar', str(SR),
           '-ac', str(channels), '-af', 'aresample=resampler=soxr' if soxr_ok() else 'anull', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    if channels > 1:
        x = x.reshape(-1, channels)
    s = int(start * SR)
    e = len(x) if end is None else int(end * SR)
    return x[s:e].copy()


_soxr: bool | None = None


def soxr_ok() -> bool:
    global _soxr
    if _soxr is None:
        out = subprocess.run([FFMPEG, '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100', '-t', '0.01',
                              '-af', 'aresample=48000:resampler=soxr', '-f', 'null', '-'], capture_output=True)
        _soxr = out.returncode == 0
    return _soxr


def hpf(x: np.ndarray, f: float, order: int = 4) -> np.ndarray:
    sos = signal.butter(order, f, 'highpass', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def lpf(x: np.ndarray, f: float, order: int = 4) -> np.ndarray:
    sos = signal.butter(order, f, 'lowpass', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def shelf_low(x: np.ndarray, f: float, gain_db: float) -> np.ndarray:
    """Low shelf via a parallel low-passed copy (adds weight to thin recordings)."""
    return x + (10 ** (gain_db / 20) - 1) * lpf(x, f, 2)


def fades(x: np.ndarray, fin: float = 0.002, fout: float = 0.04) -> np.ndarray:
    x = x.copy()
    n_in = min(len(x) // 2, max(1, int(fin * SR)))
    n_out = min(len(x) // 2, max(1, int(fout * SR)))
    ramp_in = np.sin(np.linspace(0, np.pi / 2, n_in)) ** 2
    ramp_out = np.cos(np.linspace(0, np.pi / 2, n_out)) ** 2
    if x.ndim == 2:
        ramp_in, ramp_out = ramp_in[:, None], ramp_out[:, None]
    x[:n_in] *= ramp_in
    x[-n_out:] *= ramp_out
    return x


def trim(x: np.ndarray, rel_db: float = -50, pre: float = 0.004, post: float = 0.03) -> np.ndarray:
    """Cuts leading and trailing silence below `rel_db` of the peak."""
    mono = np.abs(x) if x.ndim == 1 else np.abs(x).max(axis=1)
    th = mono.max() * 10 ** (rel_db / 20)
    idx = np.where(mono > th)[0]
    if len(idx) == 0:
        return x
    s = max(0, idx[0] - int(pre * SR))
    e = min(len(x), idx[-1] + int(post * SR))
    return x[s:e]


def pitch(x: np.ndarray, semitones: float) -> np.ndarray:
    """Varispeed: resamples so playback is `semitones` lower/higher (length changes too)."""
    if semitones == 0:
        return x
    ratio = Fraction(2 ** (-semitones / 12)).limit_denominator(400)
    return signal.resample_poly(x, ratio.numerator, ratio.denominator, axis=0)


def envelope_db(x: np.ndarray, hop: float = 0.005) -> np.ndarray:
    h = int(hop * SR)
    m = x if x.ndim == 1 else x.mean(axis=1)
    n = len(m) // h
    frames = m[: n * h].reshape(n, h)
    return 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-12)


def gated_events(x: np.ndarray, th_db: float, min_silence: float = 0.12) -> list[tuple[float, float]]:
    """Regions above `th_db` (absolute), merged across gaps shorter than `min_silence`."""
    db = envelope_db(x)
    on = db > th_db
    out: list[tuple[float, float]] = []
    i, n = 0, len(on)
    while i < n:
        if not on[i]:
            i += 1
            continue
        j = last = i
        while j < n and (on[j] or (j - last) * 0.005 < min_silence):
            if on[j]:
                last = j
            j += 1
        out.append((i * 0.005, (last + 1) * 0.005))
        i = j
    return out


def onsets(x: np.ndarray, th_db: float = -45, rise: float = 10, min_gap: float = 0.25) -> list[float]:
    db = envelope_db(x)
    out: list[float] = []
    last = -1e9
    for i in range(3, len(db)):
        t = i * 0.005
        if db[i] > th_db and db[i] - db[i - 3] > rise and t - last > min_gap:
            out.append(max(0.0, t - 0.015))
            last = t
    return out


def strikes(x: np.ndarray, th_db: float, min_dist: float, lookback: float = 0.12, drop: float = 18) -> list[float]:
    """Start times of discrete hits (steps): the loudest point in each `min_dist` window, walked back to
    where the hit begins (the heel before a louder toe, say) so a slice always opens on its attack."""
    db = envelope_db(x)
    w = max(1, int(min_dist / 0.005))
    peaks = [i for i in range(len(db)) if db[i] > th_db and db[i] == db[max(0, i - w // 2):i + w // 2 + 1].max()]
    out: list[float] = []
    for p in peaks:
        s = p
        for j in range(p, max(0, p - int(lookback / 0.005)) - 1, -1):
            if db[j] > db[p] - drop:
                s = j
        t = max(0.0, s * 0.005 - 0.004)
        if not out or t - out[-1] > min_dist * 0.8:
            out.append(t)
    return out


def seg(x: np.ndarray, a: float, b: float) -> np.ndarray:
    return x[int(a * SR):int(b * SR)]


def loopify(x: np.ndarray, xfade: float) -> np.ndarray:
    """Cross-fades the last `xfade` seconds into the head so the result loops without a seam."""
    n = int(xfade * SR)
    body = x[:-n].copy()
    tail = x[-n:]
    k = np.linspace(0, np.pi / 2, n)
    a, b = np.sin(k), np.cos(k)
    if x.ndim == 2:
        a, b = a[:, None], b[:, None]
    body[:n] = body[:n] * a + tail * b
    return body


def mix(length: float, *layers: tuple[np.ndarray, float, float]) -> np.ndarray:
    """Sums (signal, offset s, gain dB) layers into a buffer of `length` seconds (grows to fit)."""
    n = max(int(length * SR), *(int(off * SR) + len(sig) for sig, off, _ in layers))
    out = np.zeros(n)
    for sig, off, g in layers:
        o = int(off * SR)
        out[o:o + len(sig)] += sig * 10 ** (g / 20)
    return out


_meter = pyln.Meter(SR)


def kweight(x: np.ndarray) -> np.ndarray:
    y = x if x.ndim == 2 else x[:, None]
    for f in _meter._filters.values():  # noqa: SLF001 (pyloudnorm keeps the K filters here)
        y = f.passband_gain * signal.lfilter(f.b, f.a, y, axis=0)
    return y


def loudness(x: np.ndarray, mode: str) -> float:
    """'integrated' (BS.1770) or 'momentary' (max over 400 ms windows, for short one-shots)."""
    if mode == 'integrated' and len(x) > SR:
        return float(_meter.integrated_loudness(x))
    y = kweight(np.concatenate([x, np.zeros((int(0.4 * SR),) + x.shape[1:])]))
    power = (y ** 2).sum(axis=1)
    w = int(0.4 * SR)
    c = np.concatenate([[0], np.cumsum(power)])
    ms = (c[w:] - c[:-w]) / w
    return float(-0.691 + 10 * np.log10(ms.max() + 1e-12))


def peak_db(x: np.ndarray) -> float:
    return float(20 * np.log10(np.abs(x).max() + 1e-12))


def soft_limit(x: np.ndarray, ceiling_db: float) -> np.ndarray:
    """Gentle look-ahead-free limiter for the rare overs (music/beds): smooth gain reduction."""
    c = 10 ** (ceiling_db / 20)
    a = np.abs(x) if x.ndim == 1 else np.abs(x).max(axis=1)
    reduction = -np.log(np.minimum(1.0, c / np.maximum(a, 1e-12)))
    # Hold each reduction for ~5 ms either side, then smooth it: never less than needed, no clicks.
    width = 2 * int(0.005 * SR) + 1
    reduction = ndimage.uniform_filter1d(ndimage.maximum_filter1d(reduction, width), width)
    g = np.exp(-reduction)
    return x * (g if x.ndim == 1 else g[:, None])


# ---------------------------------------------------------------------------
# Banks
# ---------------------------------------------------------------------------


@dataclass
class Bank:
    name: str  # e.g. "step.stone.walk"
    category: str  # folder and lazy-load group
    variants: list[np.ndarray]
    sources: list[list[Source]]  # per variant
    target: float = -18.0
    mode: str = 'momentary'
    loop: bool = False
    bitrate: int = 56
    # Sample rate the engine decodes this bank at (memory): full band for crisp foley,
    # lower for beds and rumbles whose content stops well below the Nyquist frequency.
    decode_rate: int = 0
    spread: float = 1.5  # max dB each variant may differ from the bank mean after levelling
    note: str = ''
    files: list[str] = field(default_factory=list)
    lengths: list[float] = field(default_factory=list)


def level_bank(b: Bank) -> None:
    louds = [loudness(v, b.mode) for v in b.variants]
    mean = float(np.mean(louds))
    out = []
    for v, l in zip(b.variants, louds):
        dev = float(np.clip(l - mean, -b.spread, b.spread))
        g = b.target + dev - l
        y = v * 10 ** (g / 20)
        over = peak_db(y) - CEILING_DB
        if over > 0:
            y = soft_limit(y, CEILING_DB) if b.loop or b.mode == 'integrated' else y * 10 ** (-over / 20)
        out.append(y)
    b.variants = out


def encode(x: np.ndarray, path: str, kbps: int) -> None:
    ch = 1 if x.ndim == 1 else x.shape[1]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cmd = [FFMPEG, '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-',
           '-c:a', 'libopus', '-b:a', f'{kbps}k', '-vbr', 'on', '-compression_level', '10',
           '-application', 'audio', '-map_metadata', '-1', '-fflags', '+bitexact', '-f', 'webm', path]
    subprocess.run(cmd, input=x.astype(np.float32).tobytes(), check=True)


def pick(events: list[np.ndarray], n: int) -> list[np.ndarray]:
    """The `n` variants closest to the median loudness (drops the odd ones), in original order."""
    if len(events) <= n:
        return events
    l = np.array([loudness(e, 'momentary') for e in events])
    med = np.median(l)
    keep = sorted(np.argsort(np.abs(l - med))[:n])
    return [events[i] for i in keep]


def cut_events(x: np.ndarray, spans: list[tuple[float, float]], maxlen: float, hp: float,
               fout: float = 0.05) -> list[np.ndarray]:
    out = []
    for a, b in spans:
        y = seg(x, max(0, a - 0.004), min(b, a + maxlen) + 0.01)
        y = hpf(y, hp)
        y = trim(y, -48, post=0.02)
        out.append(fades(y, 0.002, fout))
    return out


def cut_onsets(x: np.ndarray, ons: list[float], maxlen: float, hp: float, fout: float = 0.06) -> list[np.ndarray]:
    spans = []
    for i, t in enumerate(ons):
        nxt = ons[i + 1] if i + 1 < len(ons) else t + maxlen
        spans.append((t, min(t + maxlen, nxt - 0.02)))
    return cut_events(x, spans, maxlen, hp, fout)


def build(src: Sources) -> list[Bank]:
    banks: list[Bank] = []

    def add(name: str, category: str, variants: list[np.ndarray], sources: list[Source] | list[list[Source]],
            **kw: object) -> None:
        per = sources if sources and isinstance(sources[0], list) else [sources] * len(variants)  # type: ignore[list-item]
        banks.append(Bank(name, category, variants, per, **kw))  # type: ignore[arg-type]

    # --- Footsteps: Nox_Sound's mountain boots, recorded dry and close (walk, run, jumps, scuffs). ---
    rock_walk = src.freesound(558472)
    x = load(rock_walk.path)
    walk = cut_events(x, gated_events(x, -62, 0.1), 0.42, 70)
    add('step.stone.walk', 'footsteps', pick(walk, 10), [rock_walk])

    rock_run = src.freesound(558471)
    x = load(rock_run.path)
    run = cut_onsets(x, strikes(x, -40, 0.3), 0.3, 110)
    add('step.stone.run', 'footsteps', pick(run[1:-1], 10), [rock_run])

    wet_sand = src.freesound(564893)
    x = load(wet_sand.path)
    sw = seg(x, 0, 26.6)
    add('step.sand.walk', 'footsteps', pick(cut_events(sw, gated_events(sw, -66, 0.1), 0.45, 60), 10), [wet_sand])
    sr_ = seg(x, 27.0, 34.8)
    add('step.sand.run', 'footsteps', pick(cut_onsets(sr_, strikes(sr_, -48, 0.3), 0.34, 70), 10), [wet_sand])
    # Jumps on sand: five take-off / landing pairs.
    sj = seg(x, 35.6, 48.0)
    ev = gated_events(sj, -70, 0.12)
    add('jump.sand', 'foley', cut_events(sj, ev[0::2], 0.5, 70, 0.08), [wet_sand])
    add('land.sand', 'foley', cut_events(sj, ev[1::2], 0.6, 50, 0.1), [wet_sand])
    ss = seg(x, 49.2, 56.0)
    add('scuff.sand', 'foley', cut_events(ss, gated_events(ss, -70, 0.12), 0.5, 70), [wet_sand])

    # Jumps on rock: each block is a push-off scuff and, ~0.45 s later, the landing.
    rock_jump = src.freesound(558477)
    x = load(rock_jump.path)
    takeoff, land = [], []
    for a, b in gated_events(x, -70, 0.2):
        blk = seg(x, a, b)
        hit = a + strikes(blk, -40, 2.0, lookback=0.08, drop=20)[0]
        takeoff.append(fades(hpf(seg(x, a, hit - 0.02), 70), 0.01, 0.05))
        land.append(fades(trim(hpf(seg(x, hit, min(b, hit + 0.7)), 45), -50), 0.001, 0.12))
    add('jump.stone', 'foley', [trim(t, -40) for t in takeoff], [rock_jump])
    add('land.stone', 'foley', land, [rock_jump])

    rock_seq = src.freesound(558812)
    x = load(rock_seq.path)
    sc = seg(x, 56.2, 61.6)
    add('scuff.stone', 'foley', cut_events(sc, gated_events(sc, -70, 0.1), 0.4, 70), [rock_seq])
    sp = seg(x, 62.8, 70.8)
    add('scrape.stone', 'foley', cut_events(sp, gated_events(sp, -70, 0.1), 0.65, 70, 0.08), [rock_seq])

    # --- Cloth and leather: a subtle layer under each step, and the body of jumps, grabs and climbs. ---
    shirt = src.freesound(429080)
    x = load(shirt.path)
    rustles = cut_onsets(x, onsets(x, -48, 8, 0.35), 0.28, 150, 0.08)
    add('cloth.step', 'footsteps', pick(rustles, 12), [shirt], target=-24.0)
    kcloth = [src.kenney('rpg', n) for n in ('cloth1.ogg', 'cloth2.ogg', 'cloth3.ogg', 'cloth4.ogg',
                                              'clothBelt.ogg', 'clothBelt2.ogg')]
    add('cloth.move', 'foley', [fades(trim(hpf(load(s.path), 120), -45), 0.004, 0.08) for s in kcloth],
        [[s] for s in kcloth], target=-21.0)
    leather = [src.freesound(i) for i in (501013, 501015, 501014)]
    add('leather', 'foley', [fades(trim(hpf(load(s.path), 150), -45)[: int(0.8 * SR)], 0.004, 0.15) for s in leather],
        [[s] for s in leather], target=-24.0)

    # --- Hands on stone (ledge grab). ---
    slaps: list[np.ndarray] = []
    slap_src: list[list[Source]] = []
    for sid, cuts in ((369116, [(0.0, 0.3), (0.3, 0.6), (0.6, 1.0)]), (369114, [(0.0, 0.2), (0.2, 0.6)]),
                      (389990, [(0.4, 1.0)])):
        s = src.freesound(sid)
        x = load(s.path)
        for a, b in cuts:
            y = trim(lpf(hpf(seg(x, a, b), 220, 2), 7000), -45, post=0.02)[: int(0.24 * SR)]
            slaps.append(fades(y, 0.001, 0.1))
            slap_src.append([s])
    add('hand.stone', 'foley', slaps, slap_src)

    # --- Body impacts (hurt, hard landing weight). ---
    punch = [src.kenney('impact', f'impactPunch_heavy_00{i}.ogg') for i in range(5)]
    add('body.hit', 'foley', [fades(trim(lpf(load(s.path), 5000), -45), 0.001, 0.08) for s in punch],
        [[s] for s in punch], target=-20.0)
    soft = [src.kenney('impact', f'impactSoft_heavy_00{i}.ogg') for i in range(5)]
    add('body.fall', 'foley', [fades(trim(pitch(lpf(load(s.path), 3000), -3), -45), 0.001, 0.1) for s in soft],
        [[s] for s in soft], target=-20.0)
    pickup = [src.kenney('rpg', n) for n in ('handleSmallLeather.ogg', 'handleSmallLeather2.ogg',
                                              'beltHandle1.ogg', 'beltHandle2.ogg')]
    add('pickup', 'foley', [fades(trim(hpf(load(s.path), 120), -45), 0.002, 0.06) for s in pickup],
        [[s] for s in pickup], target=-22.0)

    # --- Stone mechanisms. ---
    drag = src.freesound(738784)  # a real slab dragged over stone, eight separate pulls
    x = load(drag.path)
    pulls = [e for e in gated_events(x, -40, 0.25) if e[1] - e[0] > 0.6]
    drags = []
    for a, b in pulls:
        y = hpf(seg(x, max(0, a - 0.02), b + 0.05), 40)
        y = pitch(y, -4)  # a 2 m sandstone block is heavier than the slab in the recording
        drags.append(fades(trim(shelf_low(y, 220, 4), -45)[: int(1.6 * SR)], 0.02, 0.25))
    add('block.drag', 'mechanisms', pick(drags, 6), [drag], decode_rate=32000)

    impacts = src.freesound(554148)  # three heavy stone impacts with debris
    x = load(impacts.path)
    heavy = []
    for a, _ in gated_events(x, -60, 0.4):
        heavy.append(fades(trim(hpf(seg(x, a, a + 2.2), 30), -55), 0.001, 0.6))
    add('stone.impact', 'mechanisms', heavy, [impacts], target=-16.0, decode_rate=32000)

    rocks = src.freesound(567701)  # rocks thrown onto a pile: short stone knocks
    x = load(rocks.path)
    knocks = cut_onsets(x, onsets(x, -40, 14, 0.5), 0.5, 60, 0.12)
    add('stone.knock', 'mechanisms', [shelf_low(pitch(k, -5), 180, 3) for k in pick(knocks, 6)], [rocks],
        target=-19.0)

    debris = src.freesound(550342)  # stones falling, debris
    x = load(debris.path)
    trickles = []
    for a, b in gated_events(x, -60, 0.4):
        trickles.append(fades(trim(hpf(seg(x, a, min(b, a + 2.2)), 60), -55), 0.003, 0.5))
    add('debris', 'mechanisms', pick(trickles, 4), [debris], target=-22.0, decode_rate=32000)

    friction = [src.freesound(i) for i in (473575, 473582)]  # "small rock movement ... an ancient mechanism"
    fr = [fades(trim(hpf(load(s.path), 50), -50), 0.003, 0.08) for s in friction]
    add('stone.shift', 'mechanisms', fr + [pitch(fr[0], -3)], [[friction[0]], [friction[1]], [friction[0]]],
        target=-20.0)

    door = src.freesound(578490)  # heavy stone door: the steady grind as a loop
    x = load(door.path)
    y = shelf_low(hpf(seg(x, 3.0, 9.6), 35), 200, 3)
    add('door.grind', 'mechanisms', [loopify(y, 0.6)], [door], target=-18.0, mode='integrated', loop=True,
        decode_rate=24000)

    crumble = src.freesound(155934)  # rocks crumbling: short cracking bursts for tiles
    x = load(crumble.path)
    cracks = [fades(trim(hpf(seg(x, a, a + 0.7), 200), -45), 0.002, 0.15) for a in onsets(x, -30, 14, 0.7)]
    add('tile.crack', 'mechanisms', pick(cracks, 6), [crumble], target=-19.0)

    quake = src.freesound(222521)  # cracking earthquake
    rumble_src = src.freesound(203281)  # distant rumble
    q = load(quake.path)
    r = load(rumble_src.path)
    rumble = mix(4.0, (fades(lpf(seg(r, 4.0, 8.0), 180), 0.6, 1.2), 0, 0),
                 (fades(hpf(seg(q, 4.0, 7.6), 80), 0.4, 1.4), 0.25, -9))
    add('rumble', 'mechanisms', [rumble], [[quake, rumble_src]], target=-18.0, mode='integrated', decode_rate=24000)

    # Lever: bronze latch and clunk, then the stone mechanism answering from inside the wall.
    latch = src.kenney('rpg', 'metalLatch.ogg')
    clunk = [src.kenney('impact', f'impactWood_heavy_00{i}.ogg') for i in (0, 2)]
    plate = [src.kenney('impact', f'impactPlate_heavy_00{i}.ogg') for i in (1, 3)]
    levers = []
    lever_src = []
    for i in range(2):
        lt = fades(trim(hpf(load(latch.path), 200), -45), 0.001, 0.05)
        ck = pitch(fades(trim(load(clunk[i].path), -45), 0.001, 0.1), -5)
        pl = pitch(fades(trim(lpf(load(plate[i].path), 2500), -45), 0.001, 0.2), -7)
        sh = fr[i]
        levers.append(mix(1.4, (lt, 0.0, -6), (ck, 0.16, 0), (pl, 0.165, -12), (pitch(sh, -5), 0.3, -4)))
        lever_src.append([latch, clunk[i], plate[i], friction[i]])
    add('lever', 'mechanisms', levers, lever_src, target=-18.0)

    # --- Ambience beds and positional loops. ---
    air = src.freesound(530161)  # "Dungeon Air": air moving through a large interior
    x = load(air.path)
    add('amb.air', 'ambience', [loopify(lpf(hpf(seg(x, 60.0, 84.0), 35), 3800), 4.0)], [air], decode_rate=16000,
        target=-20.0, mode='integrated', loop=True, bitrate=40)
    wind = src.freesound(250036)  # wind through a window and under a door, with reverb
    x = load(wind.path)
    add('amb.wind', 'ambience', [loopify(lpf(hpf(seg(x, 166.0, 192.0), 60), 6000), 5.0)], [wind], decode_rate=24000,
        target=-20.0, mode='integrated', loop=True, bitrate=40)
    fire = src.freesound(558967)  # close campfire loop
    x = load(fire.path)
    add('fire', 'ambience', [loopify(hpf(x, 60), 0.5)], [fire], target=-20.0, mode='integrated', loop=True,
        bitrate=56, decode_rate=32000)
    drips: list[np.ndarray] = []
    drip_src: list[list[Source]] = []
    d1 = src.freesound(249806)  # water dripping in a cave
    x = load(d1.path)
    for a in onsets(x, -50, 10, 0.25):
        drips.append(fades(trim(hpf(seg(x, a, a + 0.45), 300), -50), 0.001, 0.1))
        drip_src.append([d1])
    d2 = src.freesound(177958)  # effected cave drips with long tails: the distant ones
    x = load(d2.path)
    for a in (1.0, 5.83, 25.19, 34.93, 42.04, 49.56):
        drips.append(fades(trim(hpf(seg(x, a, a + 1.6), 300), -55), 0.001, 0.6))
        drip_src.append([d2])
    add('drip', 'ambience', drips, drip_src, target=-24.0, spread=3.0, decode_rate=32000)

    # --- Relic and UI. ---
    bowl = src.freesound(240934)  # struck Tibetan singing bowl
    x = load(bowl.path)
    add('relic.bowl', 'ui', [fades(trim(hpf(seg(x, 0.1, 7.0), 80), -60), 0.002, 2.5)], [bowl], target=-20.0,
        mode='integrated', bitrate=64)
    clicks = [src.kenney('interface', n) for n in ('click_002.ogg', 'click_003.ogg')]
    add('ui.click', 'ui', [fades(trim(load(s.path), -50), 0.001, 0.02) for s in clicks], [[s] for s in clicks],
        target=-26.0)
    ticks = [src.kenney('interface', n) for n in ('tick_002.ogg', 'tick_004.ogg')]
    add('ui.hover', 'ui', [fades(trim(lpf(load(s.path), 6000), -50), 0.001, 0.02) for s in ticks],
        [[s] for s in ticks], target=-34.0)
    # Confirm: a small stone "tock" (the menus are carved, not digital).
    tocks = [fades(trim(pitch(k, 3), -45)[: int(0.3 * SR)], 0.001, 0.12) for k in knocks[:2]]
    add('ui.confirm', 'ui', tocks, [rocks], target=-24.0)
    return banks


# ---------------------------------------------------------------------------
# Music (the adaptive score: src/audio/score.ts maps these cues to states per level)
# ---------------------------------------------------------------------------


@dataclass
class Cue:
    """One music file. kind: 'stream' (played through, streamed), 'loop' (decoded, seamless,
    bar-aligned), 'sting' (short, decoded, over the bed)."""

    id: str
    ref: str  # Sources.music ref: 'inc:<key>' or 'sb:<key>'
    kind: str
    note: str
    start: float = 0.0
    dur: float | None = None  # excerpt length (s); loops: search window
    fade_in: float = 0.05
    fade_out: float = 2.0
    target: float = -20.0  # LUFS: integrated (streams, loops) or max momentary (stings)
    bitrate: int = 56
    bpm: float = 0.0  # loops: nominal tempo (0: estimate; -1: free time, a drone)
    bars: int = 8  # loops: length in bars of four beats
    loop_seconds: float = 30.0  # free-time loops
    rate: int = 0  # decode rate for loops and stings (memory)


CUES = [
    # Title and the chambers' intros.
    Cue('title', 'sb:age-of-wonder', 'stream', 'title screen (loops)', 40, 210, 4, 6, -18, 64),
    Cue('antechamber.intro', 'sb:memories-of-stone', 'stream', 'Antechamber intro cards', 0, 95, 0.5, 6, -20),
    Cue('cisterns.intro', 'sb:permafrost', 'stream', 'Cisterns intro cards', 0, 95, 0.5, 6, -20),
    Cue('sun_temple.intro', 'sb:hymn-to-the-dawn', 'stream', 'Temple of the Sun intro cards', 0, 100, 1, 6, -20),
    # Exploration: sparse, played once each, long silences between.
    Cue('antechamber.explore.1', 'sb:passage-of-time', 'stream', 'Antechamber exploration', 0, 175, 3, 12, -21),
    Cue('antechamber.explore.2', 'inc:lost-frontier', 'stream', 'Antechamber exploration', 0, 185, 3, 12, -21),
    Cue('cisterns.explore.1', 'inc:mirage', 'stream', 'Cisterns exploration', 0, 180, 4, 12, -22),
    Cue('cisterns.explore.2', 'sb:decoherence', 'stream', 'Cisterns exploration', 18, 180, 4, 12, -21),
    Cue('sun_temple.explore.1', 'sb:hymn-to-the-dawn', 'stream', 'Temple of the Sun exploration', 95, 180, 4, 12, -21),
    Cue('sun_temple.explore.2', 'sb:passage-of-time', 'stream', 'Temple of the Sun exploration', 150, 118, 4, 10,
        -21),
    # Relic climaxes and fanfares.
    Cue('antechamber.relic', 'inc:arcadia', 'stream', 'Antechamber relic reveal', 0, None, 1, 3, -18, 64),
    Cue('cisterns.relic', 'sb:the-great-sea', 'stream', 'Cisterns relic reveal', 100, 128, 3, 8, -18, 64),
    Cue('sun_temple.relic', 'sb:victor-lux', 'stream', 'Temple of the Sun relic reveal', 70, None, 3, 3, -18, 64),
    Cue('fanfare', 'inc:hero-theme', 'stream', 'end of level fanfare', 0, None, 0.02, 2, -17, 64),
    Cue('sun_temple.fanfare', 'inc:curtain-rises', 'stream', 'Temple of the Sun fanfare', 0, None, 0.02, 2, -17, 64),
    # Loops for the dynamic states.
    Cue('antechamber.tension', 'inc:oppressive-gloom', 'loop', 'Antechamber tension bed', 20, 110, bpm=58, bars=8,
        rate=24000),
    Cue('antechamber.combat', 'inc:curse-of-the-scarab', 'loop', 'Antechamber combat', 80, 40, bpm=190, bars=24,
        target=-19, rate=32000),
    Cue('cisterns.tension', 'inc:long-note-three', 'loop', 'Cisterns tension drone', 15, 60, bpm=-1,
        loop_seconds=30, rate=24000),
    Cue('cisterns.combat', 'inc:constance', 'loop', 'Cisterns combat', 20, 90, bpm=83, bars=12, target=-19,
        rate=32000),
    Cue('sun_temple.tension', 'inc:enter-the-maze', 'loop', 'Temple of the Sun tension', 5, 80, bpm=93, bars=12,
        target=-21, rate=24000),
    Cue('sun_temple.combat', 'sb:juggernaut', 'loop', 'Temple of the Sun combat', 140, 60, bpm=0, bars=12,
        target=-19, rate=32000),
    Cue('chase', 'inc:mistake-the-getaway', 'loop', 'chase (the rolling boulder)', 90, 30, bpm=141, bars=16,
        target=-18, rate=32000),
    Cue('boss', 'sb:goliath', 'loop', 'boss (the stone guardian)', 110, 90, bpm=0, bars=16, target=-18,
        rate=32000),
    # Stingers (louder than the beds, which duck under them).
    Cue('sting.vista', 'inc:discovery-hit', 'sting', 'a new vista revealed', 0, None, 0.01, 1.5, -15, 64,
        rate=48000),
    Cue('sting.journal', 'inc:greta-sting', 'sting', 'a journal note read', 0, 12, 0.3, 3, -18, 64, rate=32000),
    Cue('sting.secret', 'inc:mystery-sting', 'sting', 'a secret found (under the secret chord)', 0, 9, 0.05, 2.5,
        -20, 64, rate=32000),
    Cue('sting.solved', 'inc:big-hit-1', 'sting', 'a door opened by a plate or lever', 0, None, 0.005, 1.2, -15,
        64, rate=48000),
    Cue('sting.solved.2', 'inc:big-hit-2', 'sting', 'a door opened (Cisterns)', 0, None, 0.005, 1.2, -15, 64,
        rate=48000),
    Cue('sting.death', 'inc:darkness-speaks', 'sting', 'death', 0, 9, 0.01, 3, -17, 64, rate=32000),
]


def onset_env(x: np.ndarray, hop: float = 0.01) -> np.ndarray:
    """Spectral-flux onset strength of a mono signal, one value per `hop` seconds."""
    m = x if x.ndim == 1 else x.mean(axis=1)
    h = int(hop * SR)
    n = 2048
    frames = len(m) // h - n // h
    win = np.hanning(n)
    prev = None
    out = np.zeros(max(0, frames))
    for i in range(frames):
        spec = np.log1p(np.abs(np.fft.rfft(m[i * h:i * h + n] * win))[:512])
        if prev is not None:
            out[i] = np.maximum(spec - prev, 0).sum()
        prev = spec
    return out


def estimate_bpm(x: np.ndarray, lo: float = 70, hi: float = 180) -> float:
    env = onset_env(x)
    env = env - env.mean()
    ac = np.correlate(env, env, 'full')[len(env) - 1:]
    lags = np.arange(len(ac)) * 0.01
    best, best_v = 0.0, -1e18
    for bpm in np.arange(lo, hi, 0.25):
        lag = 60 / bpm / 0.01
        i = int(round(lag))
        # Sum over the first four multiples so the beat, not a subdivision, wins.
        v = sum(ac[int(round(lag * k))] for k in (1, 2, 4) if int(round(lag * k)) < len(ac))
        if v > best_v:
            best, best_v = bpm, v
    del lags
    return float(best)


def chroma_frames(x: np.ndarray, hop: float = 0.05) -> np.ndarray:
    """Coarse spectral envelope frames (log magnitude in 24 bands), for comparing two moments."""
    m = x if x.ndim == 1 else x.mean(axis=1)
    h = int(hop * SR)
    n = 4096
    edges = np.geomspace(60, 8000, 25)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    idx = [np.where((freqs >= edges[i]) & (freqs < edges[i + 1]))[0] for i in range(24)]
    frames = max(0, (len(m) - n) // h)
    out = np.zeros((frames, 24))
    win = np.hanning(n)
    for i in range(frames):
        spec = np.abs(np.fft.rfft(m[i * h:i * h + n] * win))
        out[i] = [np.log1p(spec[j].mean()) for j in idx]
    return out


def find_loop(x: np.ndarray, length: float, window: tuple[float, float], flex: float = 0.004,
              beat: float = 0.0) -> tuple[float, float]:
    """Best (start, length) inside `window` so the music at start+length matches the music at start:
    compares 2 s of spectral envelope, tries lengths within ±flex, and starts on onsets when `beat`."""
    hop = 0.05
    feats = chroma_frames(x, hop)
    span = int(2.0 / hop)
    a, b = int(window[0] / hop), int(window[1] / hop)
    candidates = range(a, max(a + 1, b))
    if beat:
        env = onset_env(x)
        peaks = [i * 0.01 for i in range(1, len(env) - 1)
                 if env[i] >= env[i - 1] and env[i] >= env[i + 1] and env[i] > np.percentile(env, 75)]
        candidates = sorted({int(round(t / hop)) for t in peaks if window[0] <= t < window[1]})
    best = (window[0], length, 1e18)
    for L in np.linspace(length * (1 - flex), length * (1 + flex), 9):
        k = int(round(L / hop))
        for i in candidates:
            if i + k + span >= len(feats):
                continue
            d = float(np.mean((feats[i:i + span] - feats[i + k:i + k + span]) ** 2))
            if d < best[2]:
                best = (i * hop, float(L), d)
    return best[0], best[1]


def build_music(src: Sources, only: set[str] | None) -> dict[str, dict[str, object]]:
    out: dict[str, dict[str, object]] = {}
    for c in CUES:
        s = src.music(c.ref)
        rel = f'music/{c.id.replace(".", "-")}.webm'
        entry: dict[str, object] = {'file': rel, 'kind': c.kind, 'source': s.key, 'note': c.note}
        out[c.id] = entry
        if only and c.id not in only and 'music' not in only:
            continue
        stereo = load(s.path, channels=2)
        if c.kind == 'loop':
            if c.bpm < 0:
                length, beat = c.loop_seconds, 0.0
                bpm = 0.0
            else:
                bpm = c.bpm or estimate_bpm(seg(stereo, c.start, c.start + (c.dur or 60)))
                beat = 60 / bpm
                length = c.bars * 4 * beat
            end = c.start + (c.dur or 60)
            st, L = find_loop(stereo, length, (c.start, max(c.start + 0.1, end - length)), beat=beat)
            xf = max(beat, 0.25) if beat else 3.0
            y = seg(stereo, st, st + L + xf)
            y = loopify(y, xf)
            entry.update({'bpm': round(60 / (L / (c.bars * 4)), 3) if beat else 0, 'bars': c.bars if beat else 0,
                          'length': round(len(y) / SR, 4), 'rate': c.rate, 'loop': True,
                          'from': round(st, 3)})
            g = c.target - loudness(y, 'integrated')
            y = soft_limit(y * 10 ** (g / 20), CEILING_DB)
        else:
            y = seg(stereo, c.start, c.start + c.dur) if c.dur else seg(stereo, c.start, len(stereo) / SR)
            y = trim(y, -70, pre=0.0, post=0.3)
            y = fades(y, c.fade_in, c.fade_out)
            mode = 'momentary' if c.kind == 'sting' else 'integrated'
            g = c.target - loudness(y, mode)
            y = soft_limit(y * 10 ** (g / 20), CEILING_DB)
            if c.kind == 'sting':
                entry['rate'] = c.rate
        encode(y, os.path.join(OUT, rel), c.bitrate)
        entry['duration'] = round(len(y) / SR, 3)
        print(f'{c.id:24s} {c.kind:6s} {len(y) / SR:6.1f} s  {os.path.getsize(os.path.join(OUT, rel)) / 1024:7.1f} KB'
              + (f'  bpm {entry.get("bpm")} from {entry.get("from")}' if c.kind == 'loop' else ''))
    return out


def credits_md(banks: list[Bank], music: dict[str, dict[str, object]], src: Sources) -> str:
    lines = [
        '# Audio credits',
        '',
        'Every recorded sound and piece of music in `public/audio/`, with its source and licence.',
        'Built by `scripts/audio/build_audio.py` (slicing, clean-up, levelling, Opus encoding);',
        'the processing does not change the licences below. CC0 works need no attribution;',
        'they are credited anyway.',
        '',
        '## Music (CC-BY 4.0: attribution required)',
        '',
    ]
    for cue, m in music.items():
        s = src.used[str(m['source'])]
        if s.key.startswith('sb:'):
            credit = (f'{s.title} by Scott Buckley, released under CC-BY 4.0. www.scottbuckley.com.au '
                      f'(<{s.license_url}>). Source: <{s.url}>')
        else:
            credit = (f'{s.title} Kevin MacLeod (incompetech.com). Licensed under Creative Commons: '
                      f'By Attribution 4.0 License, <{s.license_url}>. Source: <{s.url}>')
        lines.append(f'- `{m["file"]}` ({cue}: {m["note"]}): {credit}')
    lines += ['', '## Sound effects (CC0)', '', 'One line per bank; `01-10` is a range of numbered variants.', '']

    def cite(per: list[Source]) -> str:
        return ' + '.join(f'"{s.title}" by {s.author} (<{s.url}>, {s.license})' for s in per)

    for b in banks:
        stem = b.files[0].rsplit('-', 1)[0]
        groups: list[tuple[int, int, list[Source]]] = []
        for i, per in enumerate(b.sources):
            if groups and [x.title for x in groups[-1][2]] == [x.title for x in per]:
                groups[-1] = (groups[-1][0], i, per)
            else:
                groups.append((i, i, per))
        parts = []
        for a, z, per in groups:
            rng = f'{a + 1:02d}' if a == z else f'{a + 1:02d}-{z + 1:02d}'
            parts.append(f'{rng}: {cite(per)}' if len(groups) > 1 else cite(per))
        lines.append(f'- `{stem}-*.webm` ({b.name}, {len(b.files)} files): ' + '; '.join(parts))
    lines += ['', '## Sources', '']
    for s in sorted(src.used.values(), key=lambda s: (s.author.lower(), s.title)):
        lines.append(f'- {s.title} by {s.author}: <{s.url}> ({s.license})')
    return '\n'.join(lines) + '\n'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.environ.get('AUDIO_CACHE', os.path.join(ROOT, 'scripts', 'audio', '.cache')))
    ap.add_argument('--only', default='', help='comma-separated bank names to rebuild (manifest keeps the rest)')
    a = ap.parse_args()
    only = set(filter(None, a.only.split(',')))
    src = Sources(a.cache)
    banks = build(src)
    if not only:
        # A full build owns public/audio: drop files left over from renamed or removed banks.
        for folder, _, files in os.walk(OUT):
            for f in files:
                if f.endswith('.webm'):
                    os.remove(os.path.join(folder, f))
    old = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {'banks': {}}
    manifest: dict[str, object] = {
        '//': 'Generated by scripts/audio/build_audio.py. Paths are relative to public/audio/.',
        'banks': {},
        'music': {},
    }
    total = 0
    for b in banks:
        stem = b.name.replace('.', '-')
        b.files = [f'{b.category}/{stem}-{i + 1:02d}.webm' for i in range(len(b.variants))]
        if only and b.name not in only:
            manifest['banks'][b.name] = old['banks'].get(b.name)  # type: ignore[index]
            continue
        level_bank(b)
        for f, v in zip(b.files, b.variants):
            encode(v, os.path.join(OUT, f), b.bitrate)
            b.lengths.append(round(len(v) / SR, 4))
        entry: dict[str, object] = {'category': b.category, 'files': b.files}
        if b.decode_rate:
            entry['rate'] = b.decode_rate
        if b.loop:
            entry['loop'] = True
            entry['length'] = b.lengths[0]
        manifest['banks'][b.name] = entry  # type: ignore[index]
        size = sum(os.path.getsize(os.path.join(OUT, f)) for f in b.files)
        total += size
        print(f'{b.name:18s} {len(b.files):2d} files {size / 1024:7.1f} KB  '
              f'{min(b.lengths):.2f}-{max(b.lengths):.2f} s')
    music = build_music(src, only or None)
    old_music = old.get('music', {}) if isinstance(old, dict) else {}
    manifest['music'] = {
        k: {kk: vv for kk, vv in v.items() if kk not in ('source', 'note')} if 'duration' in v else old_music.get(k)
        for k, v in music.items()
    }
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    json.dump(manifest, open(MANIFEST, 'w'), indent=2)
    open(os.path.join(OUT, 'CREDITS.md'), 'w').write(credits_md(banks, music, src))
    # Keep the generated files in the repo's Prettier style (best effort: needs `pnpm install`).
    subprocess.run(['pnpm', 'exec', 'prettier', '--write', MANIFEST, os.path.join(OUT, 'CREDITS.md')], cwd=ROOT,
                   capture_output=True)
    msize = sum(os.path.getsize(os.path.join(OUT, str(m['file']))) for m in music.values()
                if os.path.exists(os.path.join(OUT, str(m['file']))))
    loops = [c for c in CUES if c.kind == 'loop']
    print(f'music: {len(CUES)} cues ({len(loops)} loops)')
    print(f'sfx {total / 1024 / 1024:.2f} MB, music {msize / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main()
