import {path as ffmpegPath} from '@ffmpeg-installer/ffmpeg';
// @ts-ignore
import {path as ffprobePath} from '@ffprobe-installer/ffprobe';
import ffmpeg from 'fluent-ffmpeg';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

export default ffmpeg;
