/** Roku reports media times as strings such as "30000 ms". Returns the milliseconds, or 0. */
export const parseTime = (timeStr?: string): number => {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

/** Milliseconds as m:ss, or h:mm:ss from an hour up. */
export const formatTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
