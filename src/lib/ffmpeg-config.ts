import ffmpeg from 'fluent-ffmpeg';

// fluent-ffmpeg will use the system ffmpeg/ffprobe from PATH
ffmpeg.setFfprobePath('/usr/bin/ffprobe');
ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');

export { ffmpeg };
