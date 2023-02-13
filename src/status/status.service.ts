import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL || '');

interface Status {
  id: string;
  timestamp?: string;
  status: string;
  progress?: number;
  [key: string]: any;
}

const KEY_EXPIRE_TIME = 7200; // Seconds, 2 hours

export function updateStatus(data:Status) {
  redis.set(
      `transcode:${data.id}`, JSON.stringify({
        ...data,
        updatedAt: new Date().toISOString(),
      }),
      'EX', KEY_EXPIRE_TIME,
  );
}

export async function getStatus(id:string) {
  const data = await redis.get(`transcode:${id}`);

  if (!data) return {};
  return JSON.parse(data);
}

export function updateScreenshots(data:Array<any>, id:string) {
  redis.set(
      `transcode:screenshots:${id}`, JSON.stringify(data),
      'EX', KEY_EXPIRE_TIME,
  );
}

export async function getScreenshots(id:string) {
  const data = await redis.get(`transcode:screenshots:${id}`);

  if (!data) return [];
  return JSON.parse(data);
}
