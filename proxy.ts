import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// In-memory rate limiting map for edge/middleware runtime instance
const ipMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string, limit: number, windowMs: number): boolean {
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

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;

    // 1. Rate Limiting for /api/contribute (Edge Case 1)
    if (pathname.startsWith("/api/contribute")) {
      const forwarded = req.headers.get("x-forwarded-for");
      const ip = forwarded ? forwarded.split(",")[0].trim() : ((req as any).ip || "unknown");
      
      if (!checkRateLimit(ip, 5, 20000)) { // 5 requests per 20 seconds
        return new NextResponse(
          JSON.stringify({ error: "Rate limit dépassé" }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        const { pathname } = req.nextUrl;
        // Don't require authentication for public endpoints like /api/contribute
        if (pathname.startsWith("/api/contribute")) {
          return true;
        }
        return !!token;
      },
    },
    pages: {
      signIn: "/admin/login",
    },
  }
);

// Matcher : /admin/* (except login) and /api/contribute
export const config = {
  matcher: ["/admin/((?!login$|login/).*)", "/api/contribute"],
};
