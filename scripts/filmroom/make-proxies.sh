#!/usr/bin/env bash
# Proxy film: six 720-frame VP9 clips at NBA's 29.97 fps (30000/1001), used when a play has no live NBA clip and no
# local game film. Each frame burns in its index three ways: as text, as timecode, and as a 16-bit barcode along
# the bottom edge (lit = 1, MSB first, framed by two always-lit guard blocks). The e2e suite reads the barcode
# back from pixels to prove frame-accurate stepping. t₀ (the play's sync anchor) sits at 12.012 s = frame 360.
set -euo pipefail
out="${1:-public/filmroom/proxy}"
mkdir -p "$out"
font=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
tints=("0x0f1216" "0x10140f" "0x14100f" "0x0f1014" "0x13120e" "0x0e1313")
for k in 0 1 2 3 4 5; do
  bits=""
  for b in $(seq 0 15); do
    x=$((64 + b * 32))
    p=$((15 - b))
    bits+="drawbox=x=${x}:y=344:w=30:h=12:color=0x6b737d:t=fill:enable='eq(mod(floor(n/pow(2\,${p}))\,2)\,1)',"
  done
  ffmpeg -v error -y -f lavfi -i "color=c=${tints[$k]}:s=640x360:r=30000/1001:d=24.024" -vf "\
drawbox=x=0:y=338:w=640:h=22:color=black:t=fill,\
drawbox=x=40:y=344:w=16:h=12:color=0x6b737d:t=fill,drawbox=x=584:y=344:w=16:h=12:color=0x6b737d:t=fill,\
${bits}\
drawtext=fontfile=${font}:text='▏':x='mod(n*6\,624)':y=150:fontsize=40:fontcolor=0x1c2026,\
drawtext=fontfile=${font}:text='PROXY ${k}':x=16:y=14:fontsize=8:fontcolor=0x3a4048,\
drawtext=fontfile=${font}:text='%{eif\:n\:d\:4}':x=w-tw-16:y=14:fontsize=8:fontcolor=0x3a4048,\
drawtext=fontfile=${font}:text='t-t0 %{eif\:(n-360)*1001/30\:d}ms':x=w-tw-16:y=26:fontsize=7:fontcolor=0x30353c" \
    -c:v libvpx-vp9 -b:v 0 -crf 48 -g 15 -keyint_min 15 -row-mt 1 -deadline good -cpu-used 4 -pix_fmt yuv420p -an "$out/p${k}.webm"
done
ls -la "$out"
