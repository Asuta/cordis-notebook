# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.4", "numpy", "opencv-python-headless"]
# ///
"""Rebuild Shion's own front-facing rig with the vendored Mesh Avatar tools.

Run: uv run scripts/build-shion.py (from this plugin).
Source and facial drawings live in assets/avatar/shion; no image API is used.
"""
import importlib.util
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

GAME = Path(__file__).resolve().parents[1]
PROJECT = GAME / 'assets/avatar/shion'
TOOLS = GAME / 'mesh-avatar/vendor/tools'
sys.path.insert(0, str(TOOLS))
import agent_common

# Keep the upstream tools unchanged; their containment boundary is this plugin.
agent_common.ROOT = GAME

def load_tool(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def ellipse(x, y, rx, ry, **extra):
    return dict(cx=x, cy=y, rx=rx, ry=ry, **extra)

def strand(name, nodes, sigma, maximum, k=1):
    return dict(name=name, nodes=nodes, sigma=sigma, k=k, max=maximum)

rig = {
    'version': 1, 'image': {'width': 1024, 'height': 1536},
    'head': ellipse(507, 240, 245, 300, shiftX=27, shiftY=22, pivotX=505, pivotY=444, maxRoll=.13, weightBand=[405, 555], turnBand=[420, 640]),
    'body': dict(pivotX=505, pivotY=1580, maxRoll=.026, breathBand=[720, 1536], rollBand=[1050, 1536], chest=ellipse(510, 650, 215, 210), shoulders=[ellipse(300, 535, 95, 100), ellipse(717, 548, 90, 100)]),
    'face': dict(nose=ellipse(500, 314, 27, 27), mouth=ellipse(504, 353, 39, 20), eyeA=ellipse(437, 272, 48, 32), eyeB=ellipse(559, 264, 48, 32), earL=ellipse(392, 309, 17, 35), earR=ellipse(631, 282, 18, 39), brow=ellipse(546, 217, 67, 18, band=[232, 245]), jaw=ellipse(504, 390, 67, 35, band=[361, 377])),
    'buns': {'bunR': ellipse(685, 252, 40, 57)},
    'eyes': [
        {'opening': [[408, 272], [415, 265], [425, 260], [437, 258], [448, 259], [458, 263], [464, 269], [464, 276], [457, 283], [445, 287], [432, 289], [420, 285], [412, 280]],
         'roi': [[397, 265], [404, 254], [416, 249], [436, 247], [453, 250], [467, 258], [475, 271], [469, 285], [455, 293], [433, 297], [414, 292], [403, 280]]},
        {'opening': [[533, 260], [539, 253], [549, 249], [562, 248], [576, 250], [587, 254], [592, 259], [586, 271], [576, 277], [564, 280], [549, 280], [539, 276], [534, 270]],
         'roi': [[526, 258], [532, 246], [545, 239], [565, 238], [585, 241], [599, 248], [605, 258], [596, 272], [585, 283], [565, 288], [544, 287], [531, 279]]},
    ],
    'mouth': dict(cx=504, cy=351, angle=-.025, halfLen=24, bow=3, area=ellipse(504, 353, 34, 21, angle=0)),
    'cheeks': [[429, 311], [572, 305]],
    'strands': [
        strand('fringe_l', [[480, 55], [458, 130], [424, 205], [386, 257]], 19, 5),
        strand('fringe_m', [[510, 49], [506, 120], [484, 201], [456, 263]], 17, 5, .9),
        strand('fringe_r', [[534, 71], [555, 133], [583, 193], [605, 245]], 17, 4, 1.05),
        strand('side_l', [[363, 205], [348, 333], [328, 455], [290, 580]], 27, 10, .65),
        strand('braid_l', [[327, 465], [300, 617], [297, 768], [322, 898]], 44, 12, .55),
        strand('side_r', [[622, 192], [623, 290], [616, 392], [626, 470]], 18, 8, .7),
        strand('ribbon', [[688, 304], [715, 408], [792, 513], [860, 645]], 21, 14, .65),
        strand('tassel', [[675, 304], [674, 333], [671, 362], [673, 391]], 13, 7, .85),
    ],
    'arms': {
        'swing': 2.2, 'bend': 3.0, 'inward': .25,
        'left': {'shoulder': [276, 555], 'elbow': [231, 922], 'wrist': [136, 1291], 'split': [[288, 794], [265, 915], [220, 1118], [175, 1284], [160, 1475]]},
        'right': {'shoulder': [733, 562], 'elbow': [762, 949], 'wrist': [833, 1297], 'split': [[719, 792], [745, 938], [786, 1119], [806, 1290], [803, 1478]]},
    },
    'mesh': {'baseCell': 12, 'fine': {'x0': 315, 'x1': 730, 'y0': 10, 'y1': 490, 'cell': 5}, 'handCell': 8, 'tasselCell': 5, 'eyeBallCell': 2, 'eyeCell': 2, 'spriteCell': 3},
    'view': {'padTop': .015, 'padSide': .04, 'gazeCenter': [500, 268], 'irisTravel': 4},
}

rig_file = PROJECT / 'rig.json'
rig_file.write_text(json.dumps(rig, indent=2) + '\n', encoding='utf-8')
layers = load_tool('build-layers')
layers.build(PROJECT, rig_file)

# The upstream colour classifier targets hair. Include Shion's jade ribbons
# explicitly in the physics mask, clipped to their own silhouette.
mask_file = PROJECT / 'built/hairmask.png'
mask = np.array(Image.open(mask_file).convert('L'))
source = np.array(Image.open(PROJECT / 'source.png').convert('RGBA'))
ribbons = np.zeros(mask.shape, np.uint8)
for polygon in (
    [[680, 304], [699, 340], [720, 391], [775, 470], [831, 542], [886, 638], [864, 682], [829, 607], [789, 548], [744, 486], [706, 414], [686, 357]],
    [[665, 307], [687, 307], [687, 394], [660, 394]],
):
    cv2.fillPoly(ribbons, [np.array(polygon, np.int32)], 255)
ribbons = np.minimum(cv2.GaussianBlur(ribbons, (0, 0), 2), source[..., 3])
Image.fromarray(np.maximum(mask, ribbons)).save(mask_file)

manifest = {'format': 'mesh-avatar', 'version': 1, 'name': '汐音 · 月下听潮', 'author': 'CordisTest / AI generated character', 'source': 'source.png', 'thumbnail': 'thumbnail.png', 'expressions': {'surprise': {'mouthOpen': .45}}}
(PROJECT / 'avatar.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
Image.open(PROJECT / 'source.png').crop((235, 0, 790, 780)).resize((356, 500), Image.Resampling.LANCZOS).save(PROJECT / 'thumbnail.png')
if (PROJECT / 'variants').exists():
    load_tool('build-sprites').build(PROJECT)
print('Shion rig rebuilt from her own landmarks; arms, hair and ribbons included.')
