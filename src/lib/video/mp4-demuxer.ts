/**
 * MP4 demuxer using mp4box.js.
 * Extracts video track info and encoded samples from MP4 files.
 * Converts samples to EncodedVideoChunk for WebCodecs VideoDecoder.
 */

import { createFile } from 'mp4box';
import type { DemuxResult, SampleInfo, AudioTrackData, AudioSampleInfo } from './types';

/**
 * MP4Demuxer reads an MP4 file and extracts video/audio track information
 * and encoded samples for WebCodecs processing.
 */
export class MP4Demuxer {
  /**
   * Demux an MP4 file, extracting track info and all samples.
   */
  async demux(file: File): Promise<DemuxResult> {
    const arrayBuffer = await file.arrayBuffer();

    return new Promise<DemuxResult>((resolve, reject) => {
      const mp4file = createFile();

      let videoTrackId: number | null = null;
      let audioTrackId: number | null = null;
      const videoSamples: SampleInfo[] = [];
      const audioSamples: AudioSampleInfo[] = [];

      let videoCodec = '';
      let videoWidth = 0;
      let videoHeight = 0;
      let videoFramerate = 30;
      let videoDuration = 0;
      let videoTotalFrames = 0;
      let videoDescription: Uint8Array | undefined;

      let audioCodec = '';
      let audioSampleRate = 44100;
      let audioNumberOfChannels = 2;

      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;

        if (!videoTrackId) {
          reject(new Error('No video track found in MP4 file'));
          return;
        }

        const audioTrackData: AudioTrackData | undefined =
          audioTrackId && audioSamples.length > 0
            ? { codec: audioCodec, sampleRate: audioSampleRate, numberOfChannels: audioNumberOfChannels, samples: audioSamples }
            : undefined;

        resolve({
          trackInfo: { codec: videoCodec, width: videoWidth, height: videoHeight, framerate: videoFramerate, duration: videoDuration, totalFrames: videoTotalFrames, description: videoDescription },
          samples: videoSamples,
          audioData: audioTrackData,
        });
      };

      mp4file.onReady = (info: any) => {
        for (const track of info.tracks as any[]) {
          if (track.type === 'video' && !videoTrackId) {
            videoTrackId = track.id;
            videoCodec = track.codec || '';
            videoWidth = Math.round(track.track_width || track.video?.width || 0);
            videoHeight = Math.round(track.track_height || track.video?.height || 0);
            videoTotalFrames = track.nb_samples || 0;

            if (track.nb_samples && track.duration && track.timescale) {
              videoFramerate = (track.nb_samples * track.timescale) / track.duration;
            }
            if (track.duration && track.timescale) {
              videoDuration = Math.round((track.duration / track.timescale) * 1_000_000);
            }

            // Extract AVCC description for H.264
            if (track.codec?.startsWith('avc')) {
              const sd = track.sampleDescriptions?.[0];
              if (sd?.avcC) {
                const avcc = sd.avcC;
                const sps = avcc.PS as Uint8Array;
                const pps = avcc.PS2 as Uint8Array;
                if (sps && pps) {
                  const bytes = new Uint8Array(7 + sps.length + pps.length);
                  bytes[0] = 1;
                  bytes[1] = avcc.AVCProfileIndication;
                  bytes[2] = avcc.profile_compatibility;
                  bytes[3] = avcc.AVCLevelIndication;
                  bytes[4] = 0xFF;
                  bytes[5] = 0xE1;
                  bytes.set(sps, 6);
                  bytes[6 + sps.length] = 1;
                  bytes.set(pps, 7 + sps.length);
                  videoDescription = bytes;
                }
              }
            }
            mp4file.setExtractionOptions(track.id, null, { nbSamples: 1024 });
          }

          if (track.type === 'audio' && !audioTrackId) {
            audioTrackId = track.id;
            audioCodec = track.codec || '';
            if (track.audio) {
              audioSampleRate = track.audio.sample_rate || 44100;
              audioNumberOfChannels = track.audio.channel_count || 2;
            }
            mp4file.setExtractionOptions(track.id, null, { nbSamples: 1024 });
          }
        }
        mp4file.start();
      };

      mp4file.onSamples = (trackId: number, _ref: any, samples: any[]) => {
        for (const sample of samples) {
          const sampleData = sample.data as Uint8Array;
          const ts = sample.timescale || 1;
          const timestamp = Math.round((sample.cts / ts) * 1_000_000);
          const duration = Math.round((sample.duration / ts) * 1_000_000);
          const isKeyFrame = !!sample.is_sync;

          if (trackId === videoTrackId) {
            videoSamples.push({ data: sampleData, timestamp, duration, isKeyFrame });
          } else if (trackId === audioTrackId) {
            audioSamples.push({ data: sampleData, timestamp, duration, isKeyFrame });
          }
        }

        if (videoTrackId && videoSamples.length >= videoTotalFrames && videoTotalFrames > 0) {
          finish();
        }
      };

      mp4file.onError = (e: string) => {
        if (!resolved) { resolved = true; reject(new Error(`MP4 parsing error: ${e}`)); }
      };

      (arrayBuffer as Record<string, unknown>).fileStart = 0;
      mp4file.appendBuffer(arrayBuffer);
      mp4file.flush();

      setTimeout(() => { if (!resolved) finish(); }, 30_000);
    });
  }

  /**
   * Convert a SampleInfo to an EncodedVideoChunk for WebCodecs VideoDecoder.
   */
  static sampleToChunk(sample: SampleInfo): EncodedVideoChunk {
    return new EncodedVideoChunk({
      type: sample.isKeyFrame ? 'key' : 'delta',
      timestamp: sample.timestamp,
      duration: sample.duration,
      data: sample.data,
    });
  }

  /**
   * Extract basic video metadata from a file for display purposes (lightweight).
   */
  static async extractMetadata(file: File): Promise<{
    width: number; height: number; fps: number; duration: number; codec: string; hasAudio: boolean;
  }> {
    const arrayBuffer = await file.arrayBuffer();

    return new Promise((resolve, reject) => {
      const mp4file = createFile();

      mp4file.onReady = (info: any) => {
        let videoTrack: any = null;
        let hasAudio = false;

        for (const track of info.tracks) {
          if (track.type === 'video' && !videoTrack) videoTrack = track;
          if (track.type === 'audio') hasAudio = true;
        }

        if (!videoTrack) { reject(new Error('No video track found')); return; }

        const fps = videoTrack.nb_samples && videoTrack.duration && videoTrack.timescale
          ? (videoTrack.nb_samples * videoTrack.timescale) / videoTrack.duration
          : 30;
        const duration = videoTrack.duration && videoTrack.timescale
          ? videoTrack.duration / videoTrack.timescale
          : 0;

        resolve({
          width: Math.round(videoTrack.track_width || videoTrack.video?.width || 0),
          height: Math.round(videoTrack.track_height || videoTrack.video?.height || 0),
          fps, duration,
          codec: videoTrack.codec || 'unknown',
          hasAudio,
        });
      };

      mp4file.onError = (e: string) => reject(new Error(`MP4 parsing error: ${e}`));

      (arrayBuffer as Record<string, unknown>).fileStart = 0;
      mp4file.appendBuffer(arrayBuffer);
      mp4file.flush();
    });
  }
}
