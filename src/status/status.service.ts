import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL || '');

interface Status {
  id: string;
  status: string;
  progress?: number;
  [key: string]: any;
}

export function updateStatus(data:Status) {
  redis.set(`transcode:${data.id}`, JSON.stringify(data));
}

export async function getStatus(id:string) {
  const data = await redis.get(`transcode:${id}`);

  if (!data) return {};
  return JSON.parse(data);
}

export function updateScreenshots(data:Array<any>, id:string) {
  redis.set(`transcode:screenshots:${id}`, JSON.stringify(data));
}

export async function getScreenshots(id:string) {
  const data = await redis.get(`transcode:screenshots:${id}`);

  if (!data) return [];
  return JSON.parse(data);
}
