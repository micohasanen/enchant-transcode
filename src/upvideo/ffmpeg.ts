import {existsSync} from 'fs';
import {path as bundledFfmpegPath} from '@ffmpeg-installer/ffmpeg';
// @ts-ignore
import {path as bundledFfprobePath} from '@ffprobe-installer/ffprobe';
import ffmpeg from 'fluent-ffmpeg';

// Prefer the system ffmpeg installed in the Docker image. The bundled static
// builds segfault on network inputs (HLS URLs) on newer Debian/glibc.
const ffmpegPath = process.env.FFMPEG_PATH ||
  (existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : bundledFfmpegPath);
const ffprobePath = process.env.FFPROBE_PATH ||
  (existsSync('/usr/bin/ffprobe') ? '/usr/bin/ffprobe' : bundledFfprobePath);

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

export default ffmpeg;
