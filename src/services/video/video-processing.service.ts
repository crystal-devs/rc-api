// services/video/video-processing.service.ts
// ffmpeg-based video processing: poster frame extraction + single 720p compressed transcode.
// Runs as a subprocess via fluent-ffmpeg — never blocks the Node event loop.

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

const s3Client = new S3Client({
  region: keys.awsRegion as string,
  credentials: {
    accessKeyId: keys.awsAccessKeyId as string,
    secretAccessKey: keys.awsSecretAccessKey as string,
  },
});

/** 720p output — a single compressed tier, not a full bitrate ladder (see docs/VIDEO_IMAGE_PIPELINE.md). */
const TARGET_HEIGHT = 720;
const TARGET_CRF = 23;
const TARGET_AUDIO_BITRATE = '128k';

export interface VideoProcessingResult {
  posterKey: string;
  compressedKey: string;
  durationSeconds: number;
  width: number;
  height: number;
}

function tempPath(suffix: string): string {
  return path.join(os.tmpdir(), `rc-video-${crypto.randomUUID()}${suffix}`);
}

async function downloadToTemp(s3Key: string): Promise<string> {
  const dest = tempPath(path.extname(s3Key) || '.mp4');
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: keys.s3BucketName as string, Key: s3Key })
  );
  const body = response.Body as Readable;

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(dest);
    body.pipe(writeStream);
    body.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
  });

  return dest;
}

async function uploadFile(localPath: string, s3Key: string, contentType: string): Promise<void> {
  const body = fs.readFileSync(localPath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: keys.s3BucketName as string,
      Key: s3Key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
}

function probe(filePath: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const videoStream = data.streams.find((s) => s.codec_type === 'video');
      resolve({
        duration: data.format.duration || 0,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
      });
    });
  });
}

function extractPosterFrame(inputPath: string, outputPath: string, atSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: [atSeconds],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '640x?',
      })
      .on('end', () => resolve())
      .on('error', reject);
  });
}

function transcodeTo720p(inputPath: string, outputPath: string, sourceHeight: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate(TARGET_AUDIO_BITRATE)
      .outputOptions([`-crf ${TARGET_CRF}`, '-preset veryfast', '-movflags +faststart']);

    // Never upscale — only cap height at TARGET_HEIGHT for sources taller than that.
    if (sourceHeight > TARGET_HEIGHT) {
      command.videoFilters(`scale=-2:${TARGET_HEIGHT}`);
    }

    command
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/**
 * Process an uploaded original video: extract a poster frame and produce a single
 * compressed 720p (max) H.264/AAC playback variant. Cleans up all temp files itself,
 * including on failure.
 */
export async function processVideo(originalS3Key: string, eventId: string, uploadId: string): Promise<VideoProcessingResult> {
  const inputPath = await downloadToTemp(originalS3Key);
  const posterPath = tempPath('.jpg');
  const compressedPath = tempPath('.mp4');

  try {
    const { duration, width, height } = await probe(inputPath);

    // Grab the poster at 10% into the clip (never past 1s for very short clips),
    // so it's less likely to land on a black opening frame.
    const posterAt = Math.min(1, duration * 0.1) || 0;
    await extractPosterFrame(inputPath, posterPath, posterAt);
    await transcodeTo720p(inputPath, compressedPath, height);

    const posterKey = `events/${eventId}/variants/thumbnails/poster/${uploadId}.jpg`;
    const compressedKey = `events/${eventId}/variants/videos/720p/${uploadId}.mp4`;

    await uploadFile(posterPath, posterKey, 'image/jpeg');
    await uploadFile(compressedPath, compressedKey, 'video/mp4');

    logger.info(`Video processed: ${uploadId} (${width}x${height}, ${duration.toFixed(1)}s)`);

    return { posterKey, compressedKey, durationSeconds: duration, width, height };
  } finally {
    for (const p of [inputPath, posterPath, compressedPath]) {
      fs.promises.unlink(p).catch(() => {});
    }
  }
}
