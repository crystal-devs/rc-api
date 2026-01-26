import cron, { ScheduledTask } from 'node-cron';
import { logger } from '@utils/logger';
import { cleanupDeletedMedia } from '@services/media/media-management.service';

class CronService {
    private static instance: CronService;
    private tasks: ScheduledTask[] = [];

    private constructor() { }

    public static getInstance(): CronService {
        if (!CronService.instance) {
            CronService.instance = new CronService();
        }
        return CronService.instance;
    }

    public initialize(): void {
        logger.info('Initializing Cron Service...');

        // Schedule media cleanup to run every day at 03:00 AM
        this.scheduleTask('0 3 * * *', async () => {
            logger.info('Starting scheduled media cleanup job...');
            try {
                await cleanupDeletedMedia();
                logger.info('Scheduled media cleanup job completed successfully.');
            } catch (error) {
                logger.error('Scheduled media cleanup job failed:', error);
            }
        });

        logger.info(`Cron Service initialized with ${this.tasks.length} active tasks.`);
    }

    private scheduleTask(cronExpression: string, task: () => void): void {
        const scheduledTask = cron.schedule(cronExpression, task);
        this.tasks.push(scheduledTask);
    }
}

export const cronService = CronService.getInstance();
