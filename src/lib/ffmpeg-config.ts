import ffmpeg from 'fluent-ffmpeg';
import { getFfmpegPath, getFfprobePath } from './paths';

// Set ffmpeg/ffprobe paths based on environment (local vs Vercel)
ffmpeg.setFfmpegPath(getFfmpegPath());
ffmpeg.setFfprobePath(getFfprobePath());

export { ffmpeg };
