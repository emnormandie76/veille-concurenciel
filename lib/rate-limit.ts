const ipMap = new Map<string, { count: number, resetTime: number }>();

export function checkRateLimit(ip: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const record = ipMap.get(ip);
    if (!record) {
        ipMap.set(ip, { count: 1, resetTime: now + windowMs });
        return true;
    }
    if (now > record.resetTime) {
        ipMap.set(ip, { count: 1, resetTime: now + windowMs });
        return true;
    }
    if (record.count >= limit) {
        return false;
    }
    record.count += 1;
    return true;
}
