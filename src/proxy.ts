import { NextRequest, NextResponse } from "next/server";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Block development seed route in production unless explicitly enabled
  if (
    pathname.startsWith("/api/dev/") &&
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEV_SEED !== "true"
  ) {
    return NextResponse.json(
      { error: "Endpoint desabilitado em produção." },
      { status: 403 }
    );
  }

  // CSRF Defense-in-Depth: Verify Origin/Referer host matches Host on API mutations
  if (pathname.startsWith("/api/") && MUTATION_METHODS.has(req.method)) {
    const requestHost =
      req.headers.get("x-forwarded-host") || req.headers.get("host");
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");

    if (requestHost) {
      const normalizedHost = requestHost.split(",")[0].trim().toLowerCase();

      if (origin) {
        try {
          const originHost = new URL(origin).host.toLowerCase();
          if (originHost !== normalizedHost) {
            return NextResponse.json(
              { error: "Origem da requisição não autorizada (CSRF)." },
              { status: 403 }
            );
          }
        } catch {
          return NextResponse.json(
            { error: "Cabeçalho Origin inválido." },
            { status: 403 }
          );
        }
      } else if (referer) {
        try {
          const refererHost = new URL(referer).host.toLowerCase();
          if (refererHost !== normalizedHost) {
            return NextResponse.json(
              { error: "Referer da requisição não autorizado (CSRF)." },
              { status: 403 }
            );
          }
        } catch {
          return NextResponse.json(
            { error: "Cabeçalho Referer inválido." },
            { status: 403 }
          );
        }
      }
    }
  }

  const res = NextResponse.next();
  res.headers.set("X-Request-Id", crypto.randomUUID());
  return res;
}

export default proxy;

export const config = {
  matcher: ["/api/:path*"],
};
