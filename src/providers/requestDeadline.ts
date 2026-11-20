export async function withRequestDeadline<T>(
  milliseconds: number, message: string, request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
      controller.abort();
    }, milliseconds);
  });
  try {
    return await Promise.race([request(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
