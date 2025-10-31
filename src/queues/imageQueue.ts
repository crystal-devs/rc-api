// queues/imageQueue.ts - FIXED REDIS TIMEOUT ISSUES

import { Queue, Job, Worker } from 'bullmq';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';

let imageQueue: Queue | null = null;
let imageWorker: Worker | null = null;


export const getImageQueue = (): Queue | null => {
  return imageQueue;
};


