interface Video {
  url: string;
  startTime: number;
  endTime: number;
}

export interface TranscodeJob{
  videos: Array<Video>;
  overlays: Array<any>;
  name: string;
  screenshots?: boolean;
  ssCount?: number;
}
